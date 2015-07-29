var chai = require('chai');
var assert = chai.assert;
var expect = chai.expect;

describe('message-test', function() {
    describe('#local-message-test', function() {
        this.slow(1000);
        it('should send and receive messages locally', function(done) {
            var bigio = require('../bigio/bigio');
            bigio.initialize({}, function() {
                bigio.addListener({
                    topic: 'testTopic',
                    listener: function(message) {
                        expect(message).to.have.length(1);
                        expect(message[0]).to.equal('this is a test');
                        bigio.shutdown(function() {
                            done();
                        });
                    }
                });

                bigio.send({
                    topic: 'testTopic',
                    message: { value: 'this is a test' }
                });
            });
        });
    });

    describe('#local-partition-test', function() {
        it('should send and receive messages locally on a partition', function(done) {
            var bigio = require('../bigio/bigio');
            bigio.initialize({}, function() {
                bigio.addListener({
                    topic: 'testTopic',
                    partition: 'testPartition',
                    listener: function(message) {
                        expect(message).to.have.length(1);
                        expect(message[0]).to.equal('this is a test');
                        bigio.shutdown(function() {
                            done();
                        });
                    }
                });

                bigio.send({
                    topic: 'testTopic',
                    partition: 'testPartition',
                    message: { value: 'this is a test' }
                });
            });
        });
    });

    describe('#local-partition-fail', function() {
        this.slow(2000);
        it('should not receive messages cross partitions', function(done) {
            var bigio = require('../bigio/bigio');
            bigio.initialize({}, function() {
                bigio.addListener({
                    topic: 'testTopic',
                    partition: 'testPartition',
                    listener: function(message) {
                        expect(message).to.have.length(1);
                        expect(message[0]).to.equal('this is a test');
                    }
                });

                bigio.send({
                    topic: 'testTopic',
                    partition: 'otherPartition',
                    message: { value: 'this is a test' }
                });

                setTimeout(function() {
                    bigio.shutdown(function() {
                        done();
                    });
                }, 500);
            });
        });
    });
});
