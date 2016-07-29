'use strict'

const request = require('request')
const url = require('url')

function base64urlUnescape (str) {
  str += new Array(5 - str.length % 4).join('=')
  return str.replace(/\-/g, '+').replace(/_/g, '/')
}

function base64urlDecode (str) {
  return new Buffer(base64urlUnescape(str), 'base64').toString()
}

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
  constructor (credentials, options, onUpdateCredentials) {
    // TODO Add debug flag
    this.credentials = Object.assign({
      authSite: 'http://login.nunux.org',
      authPath: '/auth/realms/NunuxKeeper/protocol/openid-connect/auth',
      tokenPath: '/auth/realms/NunuxKeeper/protocol/openid-connect/token',
      apiSite: 'http://api.nunux.org/keeper'
    }, credentials)
    this.options = Object.assign({
      debug: false
    }, options)
    this.onUpdateCredentials = onUpdateCredentials || function (cred) {
      this._log('Credential updated but no callback registered.')
    }.bind(this)
    this.api = new KeeperApi(this)
  }

  _log () {
    const p1 = arguments[0]
    const pn = Array.prototype.slice.call(arguments, 1)
    console.log.apply(console, ['KeeperClient: ' + p1].concat(pn))
  }

  _debug () {
    if (this.options.debug) {
      this._log.apply(this, arguments)
    }
  }

  _error () {
    const p1 = arguments[0]
    const pn = Array.prototype.slice.call(arguments, 1)
    console.error.apply(console, ['KeeperClient: ' + p1].concat(pn))
  }

  static decodeAccessToken (token) {
    const segments = token.split('.')
    if (segments.length !== 3) {
      return {email: 'Unknown'}
    }
    const payload = JSON.parse(base64urlDecode(segments[1]))
    return payload
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
    this._debug('Getting token...', code)
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
          this._error('Unable to get token (http error).', err)
          return reject(err)
        }
        if (data.error) {
          this._error('Unable to get token.', data.error)
          return reject(data.error)
        }
        this.credentials.accessToken = data.access_token
        this.credentials.refreshToken = data.refresh_token
        this.credentials.expiresIn = data.expires_in
        this.credentials.expireTime = data.expires_in + (new Date().getTime() / 1000)
        this.credentials.tokenType = data.token_type
        const decoded = KeeperClient.decodeAccessToken(this.credentials.accessToken)
        this.credentials.displayName = decoded.email || decoded.name
        // Notify new credentials
        this.onUpdateCredentials(this.credentials)
        return resolve(this.credentials)
      })
    })
  }

  enableAutoRefreshToken () {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout)
    }
    // Compute the refresh tiemout one minute before expiration
    const timeout = this.credentials.expireTime - Date.now() - 60000
    this._debug('Expiration time:', this.credentials.expireTime)
    this._debug('Computed timeout:', timeout)
    this.refreshTimeout = setTimeout(() => {
      this._refreshToken()
    }, timeout)
  }

  _refreshToken () {
    if (!this.credentials.refreshToken) {
      this._error('Unable to refresh. No refresh token.')
      return Promise.reject('ENOREFRESHTOKEN')
    }
    return new Promise((resolve, reject) => {
      this._debug('Refreshing the token...')
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
          this._error('Unable to get refresh token (http error).', err)
          return reject(err)
        }
        if (data.error) {
          this._error('Unable to get refresh token.', data)
          return reject(data)
        }
        this.credentials.accessToken = data.access_token
        this.credentials.expiresIn = data.expires_in
        this.credentials.expireTime = Date.now() + (data.expires_in * 1000)
        this.credentials.tokenType = data.token_type
        if (data.refresh_token) {
          this.credentials.refreshToken = data.refresh_token
          if (this.refreshTimeout) {
            this.enableAutoRefreshToken()
          }
        }
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
    this._debug('%s %s', req.method, req.url)
    if (!req.hasOwnProperty('json')) {
      req.json = true
    }
    // Set access token
    req.auth = { bearer: this.credentials.accessToken }

    // Trigger refresh token if access token is expired
    if (!this.credentials.expireTime || this.credentials.expireTime < (new Date().getTime() / 1000)) {
      if (retries === 0) {
        this._error('Too many refresh attempts.')
        return Promise.reject('ETOOMANYREFRESH')
      }
      return this._refreshToken()
      .then(() => this._request(req, 0))
    }

    return new Promise((resolve, reject) => {
      request(req, (err, result, data) => {
        if (err) {
          this._error('Request error (http error).', err)
          return reject(err)
        }
        if (data.error) {
          this._error('Request error.', data.error)
          return reject(data.error)
        }
        if (result.statusCode === 401 && retries > 0) {
          retries = retries - 1
          this._error('401 received. Trying to refresh the token...')
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

