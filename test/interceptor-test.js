var chai = require('chai');
var assert = chai.assert;
var expect = chai.expect;

describe('interceptor-test', function() {
    describe('#positive-interceptor-test', function() {
        this.slow(1000);
        it('should intercept and change the message', function(done) {
            var bigio = require('../bigio/bigio');
            bigio.initialize({}, function() {
                bigio.addListener({
                    topic: 'interceptTopic1',
                    listener: function(message) {
                        expect(message).to.have.length(1);
                        expect(message[0]).to.equal(2);
                        bigio.shutdown(function() {
                            done();
                        });
                    }
                });

                bigio.addInterceptor('interceptTopic1', function(message) {
                    message.message[0]++;
                    return message;
                });

                bigio.send({
                    topic: 'interceptTopic1',
                    message: { value: 1 }
                });
            });
        });
    });

    describe('#positive-interceptor-test', function() {
        this.slow(1000);
        it('should not intercept and change the message', function(done) {
            var bigio = require('../bigio/bigio');
            bigio.initialize({}, function() {
                bigio.addListener({
                    topic: 'interceptTopic2',
                    listener: function(message) {
                        expect(message).to.have.length(1);
                        expect(message[0]).to.equal(1);
                        bigio.shutdown(function() {
                            done();
                        });
                    }
                });

                bigio.send({
                    topic: 'interceptTopic2',
                    message: { value: 1 }
                });
            });
        });
    });
});
