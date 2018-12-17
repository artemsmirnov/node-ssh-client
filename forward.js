const net = require('net');

exports.forwardIn = function(client, {hostport, host, port, bind_address}) {
    client.on('tcp connection', function(info, accept, reject) {
        const socket = new net.Socket();
        let remote;

        socket.on('error', function(err) {
            if (remote === undefined) {
                reject();
            } else {
                remote.end();
            }

            console.log('Forward error');
            console.error(err);
            process.exit(0);
        });

        socket.connect(hostport, host, function() {
            remote = accept();
            socket.pipe(remote).pipe(socket);
        });
    });

    client.forwardIn(bind_address, port, function(err) {
        if (err) {
            console.log('Unable to establish forwarding');
            console.error(err);
            process.exit(0);
        }
    });
};

exports.forwardOut = function(client, {hostport, host, port, bind_address}) {
    const server = net.createServer(function(socket) {
        client.forwardOutAsync(socket.localAddress, socket.localPort, host, hostport)
            .then(stream => {
                socket.pipe(stream).pipe(socket);
            })
            .catch(err => {
                console.log('Unable to establish forwarding');
                console.error(err);
                process.exit(0);
            });
    });

    server.on('error', err => {
        console.log('Forward error');
        console.error(err);
        process.exit(0);
    });

    server.listen(port, bind_address);
};
