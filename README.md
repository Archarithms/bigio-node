### BigIO

BigIO is a fast, distributed messaging framework for a variety of languages. 
This version of BigIO runs in NodeJS, and is fully interoperable with the
Java version.

Note: For interoperability with the Java version of BigIO, bigio-node 0.1.3 
requires Java BigIO version 1.1.2.

## Installation
Add bigio to your package.json.

```
"dependencies": {
    "bigio" : "0.1.3"
}
```

Then type ```npm install```

## Usage

Register a listener on a topic:

```
var bigio = require('bigio');

bigio.initialize(function() {
    bigio.addListener( {
        topic: 'HelloWorld',
        listener: function(message) {
            console.log('Received a message');
            console.log(message);
        }
    });
});
```

Send a message on a topic:

```
var bigio = require('bigio');

bigio.initialize(function() {
    setInterval(function() {
        bigio.send( {
            topic: 'HelloWorld',
            message: { content : 'HelloWorld' }
        });
    }, 1000);
});
```

