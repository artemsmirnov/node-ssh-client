const ssh = require('ssh2');
const Promise = require('bluebird');
const inquirer = require('inquirer');

const argv = require('yargs')
    .option('L', {
        describe: 'Remote to Local port forward'
    })
    .option('R', {
        describe: 'Remote to Local port forward'
    })
    .help()
    .argv;

Promise.promisifyAll(ssh.Client);

const {parseConnectionParams, parseForwardParams} = require('./helpers');
const Shell = require('./Shell');
const {forwardIn, forwardOut} = require('./forward');

const client = new ssh.Client();

client.on('ready', function() {
    if (argv.L) {
        const {hostport, host, port, bind_address} = parseForwardParams(argv.L);

        forwardOut(client, {hostport, host, port, bind_address});
    } else if (argv.R) {
        const {hostport, host, port, bind_address} = parseForwardParams(argv.R);

        forwardIn(client, {hostport, host, port, bind_address});
    } else {
        const shell = new Shell({
            client,
            stdout: process.stdout,
            stdin: process.stdin
        });

        shell.setup()
            .catch(err => {
                console.error(err);
                process.exit(0);
            });
    }
});

let triedPassword = false;

client.on('keyboard-interactive', function(name, instructions, instructionsLang, prompts, finish) {
    if (prompts.some(p => !p.echo)) {
        triedPassword = true;
    }

    inquirer.prompt(
        prompts.map(
            (prompt, i) => ({
                name: `${i}`,
                message: prompt.prompt,
                type: prompt.echo ? 'input' : 'password'
            })
        )
    )
        .then(answers => prompts.map((prompt, i) => answers[`${i}`]))
        .then(finish);
});

const connectionParams = parseConnectionParams(argv._[0]);

client.on('error', err => {
    if (err.message === 'All configured authentication methods failed' && !triedPassword) {
        inquirer.prompt([{
            name: 'password',
            message: 'Password:',
            type: 'password'
        }]).then(answers => {
            client.connect(Object.assign({
                password: answers.password
            }, connectionParams));
        });

        triedPassword = true;
    } else {
        console.error(err);
    }
});

if (connectionParams.password) {
    triedPassword = true;
}

client.connect(connectionParams);
