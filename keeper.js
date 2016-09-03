/**
 * Copyright 2016 Nunux Org.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License')
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

const DEBUG = process.env.NODE_ENV === 'development'

module.exports = function (RED) {
  'use strict'

  const KeeperSDK = require('node-keeper')
  const crypto = require('crypto')
  const sdk = new KeeperSDK({debug: DEBUG})

  function KeeperNode (n) {
    RED.nodes.createNode(this, n)
  }

  RED.nodes.registerType('keeper-credentials', KeeperNode, {
    credentials: {
      displayName:  {type: 'text'},
      clientId:     {type: 'text'},
      clientSecret: {type: 'password'},
      accessToken:  {type: 'password'},
      refreshToken: {type: 'password'},
      expireTime:   {type: 'password'}
    }
  })

  RED.httpAdmin.get('/keeper-credentials/auth', function (req, res) {
    if (!req.query.clientId || !req.query.clientSecret || !req.query.id || !req.query.callback) {
      res.send(400)
      return
    }
    const node_id = req.query.id
    const callback = req.query.callback
    const options = {
      clientId: req.query.clientId,
      clientSecret: req.query.clientSecret
    }
    sdk.createClient(options)
    .then((client) => {
      const csrfToken = crypto.randomBytes(18).toString('base64').replace(/\//g, '-').replace(/\+/g, '_')
      const credentials = Object.assign({
        csrfToken: csrfToken,
        callback: callback
      }, options)
      res.cookie('csrf', csrfToken)
      res.redirect(client.getAuthorizeURL(callback, node_id + ':' + csrfToken))
      RED.nodes.addCredentials(node_id, credentials)
    })
  })

  RED.httpAdmin.get('/keeper-credentials/auth/callback', function (req, res) {
    if (req.query.error) {
      return res.send('ERROR: ' + req.query.error + ': ' + req.query.error_description)
    }
    const state = req.query.state.split(':')
    const node_id = state[0]
    const credentials = RED.nodes.getCredentials(node_id)
    if (!credentials || !credentials.clientId || !credentials.clientSecret) {
      return res.send(RED._('keeper.error.no-credentials'))
    }
    // console.log('Credentials:' + JSON.stringify(credentials))
    if (state[1] !== credentials.csrfToken) {
      return res.status(401).send(
        RED._('keeper.error.token-mismatch')
      )
    }

    sdk.createClient(credentials)
    .then((client) => {
      client.getTokens(credentials.callback, req.query.code)
      .then((creds) => {
        RED.nodes.addCredentials(node_id, Object.assign({}, credentials, creds))
        return res.send(RED._('keeper.error.authorized'))
      })
      .catch((err) => {
        console.log('Keeper client error: ' + err)
        return res.send(RED._('keeper.error.something-broke'))
      })
    })
  })

  function KeeperRequestNode (n) {
    RED.nodes.createNode(this, n)
    this.action = n.action || null
    this.docid = n.docid || ''
    this.keeper = RED.nodes.getNode(n.keeper)
    var node = this
    if (!this.keeper || !this.keeper.credentials.accessToken) {
      this.warn(RED._('keeper.warn.missing-credentials'))
      return
    }

    sdk.createClient(Object.assign(this.keeper.credentials, {
      onRefreshTokens: (creds) => {
        RED.nodes.addCredentials(node.id, Object.assign({}, this.keeper.credentials, creds))
      }
    }), this.keeper.credentials)
    .then((client) => {
      node.on('input', function (msg) {
        const action = node.action || msg.action
        const docid = node.docid || msg.docid || msg.payload.id
        if (action !== null && action !== 'post') {
          if (!docid) {
            node.error(RED._('keeper.error.no-docid-specified'))
            return
          }
        }
        let result
        switch (action) {
          case 'get':
            result = client.api.document.get(docid)
            break
          case 'post':
            result = client.api.document.post(msg.payload)
            break
          case 'put':
            result = client.api.document.update({id: docid}, msg.payload)
            break
          case 'delete':
            result = client.api.document.remove({id: docid})
            break
          default:
            node.error(RED._('keeper.error.no-action-specified'))
            return
        }
        node.status({fill: 'blue', shape: 'dot', text: 'keeper.status.requesting'})
        result.then((data) => {
          msg.payload = data
          delete msg.error
          node.status({})
          node.send(msg)
        }).catch((err) => {
          node.error(RED._('keeper.error.request-failed', {err: JSON.stringify(err)}))
          node.status({fill: 'red', shape: 'ring', text: 'keeper.status.failed'})
          msg.payload = err
          msg.error = err
          msg.statusCode = 502
          node.send(msg)
        })
      })
    })
  }
  RED.nodes.registerType('keeper', KeeperRequestNode)
}
