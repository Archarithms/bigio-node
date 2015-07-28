var assert = require('assert');
var utils = require('../bigio/utils');
var codec = require('../bigio/codec/envelope-codec');
var bops = require('bops');

describe('envelope-codec', function() {
    it('should encode and decode to the same object', function() {
        var envelope = {};
        envelope.senderKey = utils.getKey({ ip: '127.0.0.1', gossipPort: 8888, dataPort: 9999 });
        envelope.executeTime = 1;
        envelope.millisecondsSinceMidnight = utils.getMillisecondsSinceMidnight();
        envelope.topic = 'TestTopic';
        envelope.partition = 'TestPartition';
        envelope.isEncrypted = false;
        envelope.type = 'class';
        envelope.payload = bops.from('');

        var encoded = codec.encode(envelope);
        var decoded = codec.decode(bops.subarray(encoded, 2));

        assert.equal(envelope.senderKey, decoded.senderKey);
        assert.equal(envelope.executeTime, decoded.executeTime);
        assert.equal(envelope.millisecondsSinceMidnight, decoded.millisecondsSinceMidnight);
        assert.equal(envelope.topic, decoded.topic);
        assert.equal(envelope.partition, decoded.partition);
        assert.equal(envelope.isEncrypted, decoded.isEncrypted);
        assert.equal(envelope.type, decoded.type);
    });
});
