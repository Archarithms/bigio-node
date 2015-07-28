/*
 * Copyright (c) 2014, Archarithms Inc.
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
var msgpack = require('msgpack5')();
var bl = require('bl');
var bops = require('bops');

/**
 * This is a class for decoding gossip messages.
 *
 * @author Andy Trimble
 */
module.exports = {

    /**
     * Decode a gossip message.
     *
     * @param bytes the raw message.
     * @return the decoded message.
     * @throws IOException in case of an error in decoding.
     */
    decode: function(bytes) {
        var message = {};

        var buff = bl(bytes);
        buff.consume(2);
        var unpacked = [];

        while(buff.length > 0) {
            try {
                unpacked.push(msgpack.decode(buff));
            } catch(err) {
                logger.warn('Error decoding message');
                logger.warn(err);
                break;
            }
        }

        var index = 0;

        var ip = unpacked[index++] + '.' + unpacked[index++] + '.' + unpacked[index++] + '.' + unpacked[index++];
        message.ip = ip;
        message.gossipPort = unpacked[index++];
        message.dataPort = unpacked[index++];
        message.millisecondsSinceMidnight = unpacked[index++];
        var hasPublicKey = unpacked[index++];
        if(hasPublicKey) {
            message.publicKey = unpacked[index++];
        }

        var tagMap = unpacked[index++];
        message.tags = {};
        for(var key in tagMap) {
            message.tags[key] = tagMap[key];
        }

        var members = unpacked[index++];
        message.members = [];
        for(var i in members) {
            var member = members[i];
            ip = member[0] + '.' + member[1] + '.' + member[2] + '.' + member[3] + ':' + member[4] + ':' + member[5];
            message.members.push(ip);
        }

        var clockArray = unpacked[index++];
        message.clock = [];
        for(var clock in clockArray) {
            message.clock.push(clockArray[clock]);
        }

        var tmpMap = unpacked[index++];
        message.eventListeners = {};
        for(var key in tmpMap) {
            var tmpList = tmpMap[key];
            message.eventListeners[key] = tmpList;
        }

        return message;
    },

    /**
     * Encode a gossip message.
     *
     * @param message a message.
     * @return the encoded form of the message.
     * @throws IOException in case of an encoding error.
     */
    encode: function(message) {

        var splitIp = message.ip.split('.');
        var members = [];

        for(var i in message.members) {
            var member = message.members[i];
            var tmplist = [];
            var keys = member.split(':');
            var memIp = keys[0].split('.');
            tmplist.push(parseInt(memIp[0]));
            tmplist.push(parseInt(memIp[1]));
            tmplist.push(parseInt(memIp[2]));
            tmplist.push(parseInt(memIp[3]));
            tmplist.push(parseInt(keys[1]));
            tmplist.push(parseInt(keys[2]));
            members.push(tmplist);
        }

        var eventListeners = {};
        for(key in message.eventListeners) {
            eventListeners[key] = message.eventListeners[key];
        }

        if(message.publicKey != undefined) {
            var toPack = [
                parseInt(splitIp[0]),
                parseInt(splitIp[1]),
                parseInt(splitIp[2]),
                parseInt(splitIp[3]),
                parseInt(message.gossipPort),
                parseInt(message.dataPort),
                Math.floor(message.millisecondsSinceMidnight),
                true,
                message.publicKey,
                message.tags,
                members,
                message.clock,
                eventListeners
            ];
        } else {
            var toPack = [
                parseInt(splitIp[0]),
                parseInt(splitIp[1]),
                parseInt(splitIp[2]),
                parseInt(splitIp[3]),
                parseInt(message.gossipPort),
                parseInt(message.dataPort),
                Math.floor(message.millisecondsSinceMidnight),
                false,
                message.tags,
                members,
                message.clock,
                eventListeners
            ];
        }

        var arr = [];
        for(i in toPack) {
            arr.push(msgpack.encode(toPack[i]));
        }
        var buff = bops.join(arr);

        var newBuff = bops.create(buff.length + 2);
        bops.copy(buff, newBuff, 2, 0, buff.length);
        bops.writeUInt16BE(newBuff, buff.length, 0);

        return newBuff;
    }
};
