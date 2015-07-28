var chai = require('chai');
var assert = chai.assert;
var utils = require('../bigio/util/utils');
var codec = require('../bigio/codec/generic-codec');
var bops = require('bops');

var simpleMessage = {
    intNum: 1,
    floatNum: 1.0,
    string: 'some string',
    dictionary: {'key1': 'value1', 'key2': 'value2'},
    strArr: ['value1', 'value2'],
    intArr: [1, 2, 3],
    floatArr: [1.0, 2.0, 3.0]
};

function makeAssertions(message, truth) {
    assert.equal(message[0], truth.intNum);
    assert.equal(message[1], truth.floatNum);
    assert.equal(message[2], truth.string);
    for(var k in message[3]) {
        assert.property(truth.dictionary, k);
        assert.equal(message[3][k], truth.dictionary[k]);
    }
    for(var k in message[4]) {
        assert.property(truth.strArr, k);
    }
    for(var k in message[5]) {
        assert.property(truth.intArr, k);
    }
    for(var k in message[6]) {
        assert.property(truth.floatArr, k);
    }
}

describe('generic-codec', function() {
    it('should encode and decode to the same object', function() {
        bytes = codec.encode(simpleMessage);
        message = codec.decode(bytes);
        makeAssertions(message, simpleMessage);
    });
});
