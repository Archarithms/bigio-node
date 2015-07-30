var chai = require('chai');
var assert = chai.assert;
var expect = chai.expect;

describe('message-test', function() {
    describe('#tcp-message-test', function() {
        this.slow(1000);
        it('should send and receive messages', function(done) {
            var bigio = require('../bigio/bigio');
            bigio.initialize({}, function() {
                bigio.addListener({
                    topic: 'tcpTestTopic',
                    listener: function(message) {
                        expect(message).to.have.length(1);
                        expect(message[0]).to.equal('this is a test');
                        bigio.shutdown(function() {
                            done();
                        });
                    }
                });

                bigio.send({
                    topic: 'tcpTestTopic',
                    message: { value: 'this is a test' }
                });
            });
        });
    });

    describe('#udp-message-test', function() {
        this.slow(1000);
        it('should send and receive messages', function(done) {
            var bigio = require('../bigio/bigio');
            bigio.initialize({protocol: 'udp'}, function() {
                bigio.addListener({
                    topic: 'udpTestTopic',
                    listener: function(message) {
                        expect(message).to.have.length(1);
                        expect(message[0]).to.equal('this is a test');
                        bigio.shutdown(function() {
                            done();
                        });
                    }
                });

                bigio.send({
                    topic: 'udpTestTopic',
                    message: { value: 'this is a test' }
                });
            });
        });
    });


    describe('#partition-test', function() {
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

    describe('#partition-fail', function() {
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

    describe('#templated-message-test', function() {
        this.slow(1000);
        it('should send and receive messages that adhere to a template', function(done) {
            var bigio = require('../bigio/bigio');
            bigio.initialize({}, function() {
                bigio.addListener({
                    topic: 'templateTopic',
                    template: {value: '', number: 0, position: {x: 0, y: 0}},
                    listener: function(message) {
                        expect(Object.keys(message)).to.have.length(3);
                        expect(message.value).to.equal('this is a test');
                        expect(message.number).to.equal(2);
                        expect(Object.keys(message.position)).to.have.length(2);
                        expect(message.position.x).to.equal(200);
                        expect(message.position.y).to.equal(200);
                        bigio.shutdown(function() {
                            done();
                        });
                    }
                });

                bigio.send({
                    topic: 'templateTopic',
                    message: {
                        value: 'this is a test',
                        number: 2,
                        position: {
                            x: 200, y: 200
                        }
                    }
                });
            });
        });
    });
});
