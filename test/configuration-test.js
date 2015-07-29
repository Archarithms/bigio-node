var assert = require('assert');

describe('configuration', function() {
    it('configure the system', function(done) {
        var bigio = require('../bigio/bigio');
        bigio.initialize({
            protocol: 'tcp',
            gossipPort: 8888,
            dataPort: 9999,
            encrypt: false,
            ssl: false,
            selfSigned: true,
            certChainFile: 'somefile.pem',
            keyFile: 'somekeyfile.pem',
            keyFilePassword: 'apassword',
            maxRetry: 4,
            retryInterval: 5000,
            connectionTimeout: 10000,
            useMulticast: false,
            multicastGroup: '239.0.0.2',
            multicastPort: 9898,
            gossipInterval: 250,
            cleanupInterval: 10000,
            logLevel: 'debug',
            logFile: 'test.log'
        }, function() {
            done();
        });
    });
});
