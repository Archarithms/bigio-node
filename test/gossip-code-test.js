var chai = require('chai');
var assert = chai.assert;
var utils = require('../bigio/utils');
var codec = require('../bigio/codec/gossip-codec');
var bops = require('bops');

describe('gossip-codec', function() {
    it('should encode and decode to the same object', function() {
        var message = {};
        message.ip = '127.0.0.1';
        message.gossipPort = 9999;
        message.dataPort = 9998;
        message.millisecondsSinceMidnight = 0;
        message.tags = {'tag1': 'value1', 'tag2': 'value2'};
        message.members = ['127.0.0.1:9999:9998'];
        message.clock = [0];
        message.listeners = {};
        message.listeners['me'] = [];
        message.listeners['me'].push('topic1');

        var encoded = codec.encode(message);
        //var decoded = codec.decode(bops.subarray(encoded, 2));
        var decoded = codec.decode(encoded);

        assert.equal(decoded.ip, message.ip);
        assert.equal(decoded.gossipPort, message.gossipPort);
        assert.equal(decoded.dataPort, message.dataPort);
        assert.equal(decoded.millisecondsSinceMidnight, message.millisecondsSinceMidnight);

        for(var k in decoded.tags) {
            assert.property(message.tags, k);
            assert.equal(decoded.tags[k], message.tags[k]);
        }

        for(var k in decoded.members) {
            assert.property(message.members, k);
        }

        for(var k in decoded.clock) {
            assert.property(message.clock, k);
        }

        for(var k in decoded.listeners) {
            assert.property(message.listeners, k);
            for(var k1 in decoded.listeners[k]) {
                assert.property(message.listeners[k], k1);
            }
        }
    });
});
