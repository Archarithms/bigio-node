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
var bl = require('bl');
var bops = require('bops');
var msgpack = require('msgpack5')();

module.exports = {

    /**
     * Decode a message.
     *
     * @param {bytes} bytes the raw message.
     * @return {Object} the decoded message.
     */
    decode: function (bytes) {
        var buff = bl(bytes);
        var unpacked = [];

        while(buff.length > 0) {
            try {
                var v = msgpack.decode(buff);
                if(bops.is(v)) {
                    var obj = this.decode(v);
                    unpacked.push(obj);
                } else {
                    unpacked.push(v);
                }
            } catch(err) {
                logger.warn('Error decoding message');
                logger.warn(err);
                break;
            }
        }

        return unpacked;
    },

    /**
     * Encode a message payload.
     *
     * @param {Object} message a message.
     * @return {bytes} the encoded form of the message.
     */
    encode: function(message) {
        var arr = [];
        for(var key in message) {
            arr.push(msgpack.encode(message[key]));
        }
        return bops.join(arr);
    }
};
