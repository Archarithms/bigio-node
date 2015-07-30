/*
 * Copyright (c) 2015, Archarithms Inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 * list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 * this list of conditions and the following disclaimer in the documentation
 * and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * The views and conclusions contained in the software and documentation are those
 * of the authors and should not be interpreted as representing official policies,
 * either expressed or implied, of the FreeBSD Project.
 */

var logger = require('winston');
var db = require('./member-database');
var MemberStatus = require('./member-status');
var gossipCodec = require('../codec/gossip-codec');
var envelopeCodec = require('../codec/envelope-codec');

/**
 * Construct a new member.
 * @param {String} ip the IP address of the member.
 * @param {Integer} gossipPort the port on which to send gossip messages.
 * @param {Integer} dataPort the port on which to send data messages.
 * @param {Object} config the configuraiton object.
 */
var RemoteMember = function(ip, gossipPort, dataPort, config) {

    this.ip = ip;
    this.dataPort = dataPort;
    this.gossipPort = gossipPort;
    this.useTCP = config.protocol == 'tcp' ? true : false;

    var maxRetry = config.maxRetry;
    var retryInterval = config.retryInterval;
    var timeout = config.connectionTimeout;

    var cipher, symmetricCipher, secretKey, key;

    var gossipSocket;
    var dataClient;

    var useSSL = config.ssl ? true : false;
    var useSelfSigned = config.selfSigned ? true : false;
    var certChainFile = config.certChainFile;
    var keyFile = config.keyFile;
    var keyPassword = config.keyFilePassword;

    var gossipConnected = false;
    var dataConnected = false;
};

RemoteMember.prototype.tags = {};
RemoteMember.prototype.sequence = 0;
RemoteMember.prototype.status = MemberStatus.Unknown;
RemoteMember.prototype.ip = '';
RemoteMember.prototype.dataPort = -1;
RemoteMember.prototype.gossipPort = -1;
RemoteMember.prototype.useTCP = true;
RemoteMember.prototype.publicKey = undefined;

/**
 * Get a pretty string.
 * @return {String} a string representation.
 */
RemoteMember.prototype.toString = function() {
    var ret = "\nMember ";
    ret += this.ip;
    ret += ":";
    ret += this.gossipPort;
    ret += ":";
    ret += this.dataPort;
    if (this.status == MemberStatus.Alive || this.status == MemberStatus.Unknown) {
        ret += "\n    is ";
    } else {
        ret += "\n    has ";
    }
    ret += this.status;

    ret += "\n    with properties";
    for (var key in this.tags) {
        ret += "\n        ";
        ret += key;
        ret += " -> ";
        ret += this.tags[key];
    }

    ret += "\n";

    return ret;
};

/**
 * Check the equality of two members.
 * @param {Object} obj a member.
 * @return {boolean} true if they are logically equal, false otherwise.
 */
RemoteMember.prototype.equals = function(obj) {
    var them = obj;

    return them.ip !== undefined && them.ip == this.ip && them.gossipPort == this.gossipPort && them.dataPort == this.dataPort;
};

/**
 * Initialize this member.
 * @param {function} cb a callback.
 */
RemoteMember.prototype.initialize = function() {
    var self = this;

    if (this.useSSL) {

    } else if (this.useTCP) {
        var net = require('net');

        this.gossipSocket = new net.Socket();
        this.gossipSocket.connect(this.gossipPort, this.ip, function () {
            logger.debug('TCP gossip socket connected with remote member ' + self.ip + ':' + self.gossipPort);
            self.gossipConnected = true;
        });
        this.gossipSocket.on('end', function () {
            logger.debug('TCP gossip socket disconnected');
        });
        this.gossipSocket.on('error', function (err) {
            self.gossipSocket.destroy();
            self.gossipConnected = false;
        });

        this.dataClient = net.connect({port: this.dataPort, host: this.ip}, function() {
            logger.debug('TCP data socket connected with remote member ' + self.ip + ':' + self.dataPort);
            self.dataConnected = true;
        });
        this.dataClient.setNoDelay(true);
        this.dataClient.on('end', function() {
            logger.debug('TCP data socket disconnected');
        });
        this.dataClient.on('error', function(err) {
            self.dataClient.destroy();
            self.dataConnected = false;
            self.status = MemberStatus.Left;
            db.updateMemberStatus(self);
        });
    } else {
        var dgram = require('dgram');

        this.gossipSocket = dgram.createSocket('udp4');
        this.gossipSocket.on('listening', function () {
            logger.debug('UDP gossip socket connected with remote member ' + self.ip + ':' + self.gossipPort);
            self.gossipConnected = true;
        });
        this.gossipSocket.on('end', function () {
            logger.debug('UDP gossip server disconnected');
        });
        this.gossipSocket.on('error', function (err) {
            self.gossipSocket().destroy();
            self.gossipConnected = false;
        });
        this.gossipSocket.bind(this.gossipPort, this.ip);

        this.dataClient = dgram.createSocket('udp4');
        this.dataClient.on('listening', function () {
            logger.debug('UDP data socket connected with remote member ' + self.ip + ':' + self.dataPort);
            self.dataConnected = true;
        });
        this.dataClient.on('end', function () {
            logger.debug('UDP data server disconnected');
        });
        this.dataClient.on('error', function (err) {
            self.dataClient.destroy();
            self.dataConnected = false;
            self.status = MemberStatus.Left;
            db.updateMemberStatus(self);
        });
        this.dataClient.bind(this.dataPort, this.ip);
    }

    if(this.publicKey !== undefined) {

    }
};

/**
 * Send a message to the remote member.
 * @param {Object} envelope an envelope.
 */
RemoteMember.prototype.send = function(message) {
    var bytes = envelopeCodec.encode(message);
    this.dataClient.write(bytes);
};

/**
 * Send a gossip message to the remote member.
 * @param {Object} message a gossip message.
 */
RemoteMember.prototype.gossip = function(message) {
    if (this.gossipConnected) {
        var bytes = gossipCodec.encode(message);
        this.gossipSocket.write(bytes);
    }
};

/**
 * Cleanly shut down this member.
 * @param {function} cb a callback
 */
RemoteMember.prototype.shutdown = function(cb) {
    logger.debug("Closed remote sockets.");
    if (this.useTCP) {
        this.gossipSocket.end();
        this.dataClient.end();
    } else {
        this.gossipSocket.close();
        this.dataClient.close();
    }

    if(typeof cb === 'function') cb();
};

module.exports = RemoteMember;
