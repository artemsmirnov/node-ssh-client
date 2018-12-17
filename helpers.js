const anser = require("anser");

const CONTROL_CHARACTERS = {
    CTRL_D: '\u0004',
    BELL: '\u0007',
    BACKSPACE: '\u0008',
    LF: '\n',
    CR: '\r',
    DELETE: String.fromCharCode(127)
};

exports.CONTROL_CHARACTERS = CONTROL_CHARACTERS;

exports.parseConnectionParams = function(uri) {
    const connectionParams = {
        keepaliveInterval: 60 * 1000,
        keepaliveCountMax: 60,
        tryKeyboard: true
    };

    const [username, host] = uri.split('@');
    if (host.includes(':')) {
        connectionParams.host = host.split(':')[0];
        connectionParams.port = parseInt(host.split(':')[1], 10);
    } else {
        connectionParams.host = host;
        connectionParams.port = 22;
    }

    if (username.includes(':')) {
        connectionParams.username = username.split(':')[0];
        connectionParams.password = username.split(':')[1];
    } else {
        connectionParams.username = username;
    }

    return connectionParams;
};

exports.parseForwardParams = function(option) {
    let [bind_address, port, host, hostport] = option.split(':');

    if (!hostport) {
        hostport = host;
        host = port;
        port = bind_address;
        bind_address = '0.0.0.0';
    }

    return {hostport, host, port, bind_address};
};

exports.toPlainString = function(text) {
    let processed = '';

    for (let i=0 ; i<text.length ; i++) {
        switch (text[i]) {
            case CONTROL_CHARACTERS.BELL:
            case CONTROL_CHARACTERS.BACKSPACE:
                break;
            case '\u001b':
                if (text[i+1] === '[' && text[i+2] === 'K') {
                    processed = processed.slice(0, -1);
                    i += 2;
                    break;
                }
            default:
                processed += text[i];
        }
    }

    return anser.ansiToText(processed);
};
