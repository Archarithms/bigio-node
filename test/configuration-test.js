var assert = require('assert');

describe('configuration', function() {
    it('configure the system', function() {
        var bigio = require('../bigio/bigio');
        bigio.initialize({
            protocol: 'tcp',
            gossipPort: 8888,
            dataPort: 9999,
            encrypt: false,
            ssl: false,
            selfSigned: false,
            certchainFile: 'somefile.pem',
            keyFile: 'somekeyfile.pem',
            keyFilePassword: 'apassword',
            maxRetry: 4,
            retryInterval: 5000,
            connectionTimeout: 10000,
            useMulticast: true,
            multicastGroup: '239.0.0.2',
            multicastPort: 9898,
            nic: 'eth0',
            gossipInterval: 250,
            cleanupInterval: 10000
        });
        /* bigio.initialize(function() {
            console.log('done');
        }); */
        /* bigio.initialize({protocol: 'udp'}, function() {
            console.log('done');
        }); */
    });
});
