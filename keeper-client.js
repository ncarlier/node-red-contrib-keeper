'use strict'

const request = require('request')
const url = require('url')

class KeeperApi {
  constructor (client) {
    this.client = client
  }

  postDocument (doc) {
    return this.client._request({
      method: 'POST',
      url: this.client.credentials.apiSite + '/v2/document',
      json: true,
      body: doc
    })
  }

  getDocument (docid) {
    return this.client._request({
      method: 'GET',
      url: this.client.credentials.apiSite + '/v2/document/' + docid,
      json: true
    })
  }

  updateDocument (doc, update) {
    return this.client._request({
      method: 'PUT',
      url: this.client.credentials.apiSite + '/v2/document/' + doc.id,
      json: true,
      body: update
    })
  }

  removeDocument (doc) {
    return this.client._request({
      method: 'DELETE',
      url: this.client.credentials.apiSite + '/v2/document/' + doc.id,
      json: true
    })
  }
}

class KeeperClient {
  constructor (credentials, onUpdateCredentials) {
    this.credentials = Object.assign({
      authSite: 'http://login.nunux.org',
      authPath: '/auth/realms/NunuxKeeper/protocol/openid-connect/auth',
      tokenPath: '/auth/realms/NunuxKeeper/protocol/openid-connect/token',
      apiSite: 'http://api.nunux.org/keeper'
    }, credentials)
    this.onUpdateCredentials = onUpdateCredentials || function (cred) {
      console.warn('KeeperClient: Credential updated but no callback registered.')
    }
    this.api = new KeeperApi(this)
  }

  authorizeURL (redirect_uri, state) {
    const u = url.parse(this.credentials.authSite)
    return url.format({
      protocol: u.protocol,
      hostname: u.hostname,
      pathname: this.credentials.authPath,
      query: {
        response_type: 'code',
        client_id: this.credentials.clientId,
        state: state,
        redirect_uri: redirect_uri
      }
    })
  }

  _tokenURL () {
    const u = url.parse(this.credentials.authSite)
    return url.format({
      protocol: u.protocol,
      hostname: u.hostname,
      pathname: this.credentials.tokenPath
    })
  }

  token (redirect_uri, code) {
    return new Promise((resolve, reject) => {
      request.post({
        url: this._tokenURL(),
        json: true,
        form: {
          grant_type: 'authorization_code',
          code: code,
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          redirect_uri: redirect_uri
        }
      }, (err, result, data) => {
        if (err) {
          console.error('KeeperClient: Unable to get token.', err)
          return reject(err)
        }
        if (data.error) {
          console.error('KeeperClient: Unable to get token.', data.error)
          return reject(data.error)
        }
        this.credentials.accessToken = data.access_token
        this.credentials.accessToken = data.access_token
        this.credentials.refreshToken = data.refresh_token
        this.credentials.expiresIn = data.expires_in
        this.credentials.expireTime = data.expires_in + (new Date().getTime() / 1000)
        this.credentials.tokenType = data.token_type
        // Notify new credentials
        this.onUpdateCredentials(this.credentials)
        return resolve(this.credentials)
      })
    })
  }

  _refreshToken () {
    if (!this.credentials.refreshToken) {
      console.error('KeeperClient: Unable to refresh. No refresh token.')
      return Promise.reject('ENOREFRESHTOKEN')
    }
    return new Promise((resolve, reject) => {
      request.post({
        url: this._tokenURL(),
        json: true,
        form: {
          grant_type: 'refresh_token',
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          refresh_token: this.credentials.refreshToken
        }
      }, (err, result, data) => {
        if (err) {
          console.error('KeeperClient: Unable to get refresh token.', err)
          return reject(err)
        }
        if (data.error) {
          console.error('KeeperClient: Unable to get refresh token.', data)
          return reject(data)
        }
        this.credentials.accessToken = data.access_token
        if (data.refresh_token) {
          this.credentials.refreshToken = data.refresh_token
        }
        this.credentials.expiresIn = data.expires_in
        this.credentials.expireTime = data.expires_in + (new Date().getTime() / 1000)
        this.credentials.tokenType = data.token_type
        // Notify new credentials
        this.onUpdateCredentials(this.credentials)
        return resolve(this.credentials)
      })
    })
  }

  _request (req, retries) {
    retries = retries || 1
    if (typeof req !== 'object') {
      req = { url: req }
    }
    req.method = req.method || 'GET'
    if (!req.hasOwnProperty('json')) {
      req.json = true
    }
    // Set access token
    req.auth = { bearer: this.credentials.accessToken }

    // Trigger refresh token if access token is expired
    if (!this.credentials.expireTime || this.credentials.expireTime < (new Date().getTime() / 1000)) {
      if (retries === 0) {
        console.error('KeeperClient: Too many refresh attempts.')
        return Promise.reject('ETOOMANYREFRESH')
      }
      return this._refreshToken()
      .then(() => this._request(req, 0))
    }

    return new Promise((resolve, reject) => {
      request(req, function (err, result, data) {
        if (err) {
          console.error('KeeperClient: Request error.', err)
          return reject(err)
        }
        if (data.error) {
          console.error('KeeperClient: Request error.', data.error)
          return reject(data.error)
        }
        if (result.statusCode === 401 && retries > 0) {
          retries = retries - 1
          console.error('KeeperClient: 401 received. Trying to refresh the token...')
          return this._refreshToken()
          .then(() => this._request(req, retries))
          .then(resolve)
          .catch(reject)
        }
        if (result.statusCode >= 400) {
          return reject(data)
        }
        return resolve(data)
      })
    })
  }
}

module.exports = KeeperClient

