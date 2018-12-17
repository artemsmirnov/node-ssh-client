const path = require('path');
const Promise = require('bluebird');

const {CONTROL_CHARACTERS, toPlainString} = require('./helpers');

const PWD_TIMEOUT = 30000;

module.exports = class Shell {
    constructor(options) {
        this.client = options.client;
        this.stdout = options.stdout;
        this.stdin = options.stdin;
        this.ignore = false;
        this.prompt = null;
        this.stream = null;

        this.sftp = null;

        this.inputProcessingPromise = Promise.resolve();
        this.line = [];
    }

    async setup() {
        this.stream = await this.client.shellAsync({ term: 'xterm' });

        this.stdin.setRawMode(true);
        this.stdin.resume();
        this.stdin.setEncoding('utf8');
        this.stdin.on('data', (chunk) => {
            this.inputProcessingPromise = this.inputProcessingPromise.then(() => this.onInput(chunk))
        });
        process.stdin.on('end', () => this.onInputEnd());

        this.stream.on('data', (chunk) => this.onOutput(chunk));
        this.stream.on('close', () => this.onStreamClose());
        this.stream.stderr.pipe(process.stderr);

    }

    onOutput(chunk) {
        for (const byte of chunk) {
            if (byte === CONTROL_CHARACTERS.CR.charCodeAt(0) || byte === CONTROL_CHARACTERS.LF.charCodeAt(0)) {
                this.line = [];
                this.prompt = null;
            } else {
                this.line.push(byte);
            }
        }

        if (!this.ignore) {
            this.stdout.write(chunk);
        }
    }

    onStreamClose() {
        this.client.end()
    }

    async onInput(chunk) {
        if (!this.prompt) {
            this.prompt = Buffer.from(this.line);
        }

        for (const char of chunk) {
            if (char === CONTROL_CHARACTERS.CTRL_D) {
                this.exit();
            }

            if (char === CONTROL_CHARACTERS.CR || char === CONTROL_CHARACTERS.LF) {
                const input = Buffer.from(this.line)
                    .slice(this.prompt.length)
                    .toString('utf8');

                const cmd = toPlainString(input).match(/\S+/g) || [];

                if (cmd[0] === 'get') {
                    try {
                        await this.getCommand(input, cmd[1]);
                    } catch (err) {
                        this.stdout.write(`Unexpected error while executing get command: ${err}`);
                    }
                    continue;
                }

                if (cmd[0] === 'put') {
                    try {
                        await this.putCommand(input, cmd[1]);
                    } catch (err) {
                        this.stdout.write(`Unexpected error while executing put command: ${err}`);
                    }
                    continue;
                }
            }

            this.stream.write(char);
        }
    }

    onInputEnd() {
        this.stream.write('end');
    }

    exit() {
        process.exit(0);
    }

    getCurrentWorkingDir() {
        return new Promise((resolve) => {
            const BEGIN_CHAR = '#';
            const END_CHAR = '#';
            const STATES = {
                START: 0,
                RECEIVED_COMMAND_ECHO: 1,
                RECEIVED_PATH_BEGIN: 2
            };

            let state = STATES.START;
            let workingDir = '';

            const pathReader = (data) => {
                for (const char of data.toString('utf8')) {
                    switch (state) {
                        case STATES.START:
                            if (char === CONTROL_CHARACTERS.CR || char === CONTROL_CHARACTERS.LF) {
                                state = STATES.RECEIVED_COMMAND_ECHO;
                            }
                            break;

                        case STATES.RECEIVED_COMMAND_ECHO:
                            if (char === BEGIN_CHAR) {
                                state = STATES.RECEIVED_PATH_BEGIN;
                            }
                            break;

                        case STATES.RECEIVED_PATH_BEGIN:
                            if (char === END_CHAR) {
                                this.stream.off('data', pathReader);
                                resolve(workingDir);
                                return;
                            }

                            workingDir += char;
                    }
                }
            };

            this.stream.on('data', pathReader);

            this.stream.write(`echo "${BEGIN_CHAR}$PWD${END_CHAR}"\n`);
        }).timeout(PWD_TIMEOUT, "Timeout: Unable to get current working directory path");
    }

    clearInput(input) {
        for (let i=0 ; i<input.length ; i++) {
            this.stream.write(CONTROL_CHARACTERS.DELETE);
        }

        this.stdout.write('\r\n');
    }

    async getSFTP() {
        if (this.sftp) {
            return this.sftp;
        }

        this.sftp = await this.client.sftpAsync();
        Promise.promisifyAll(this.sftp);

        return this.sftp;
    }

    async getCommand(input, relativePath) {
        try {
            this.ignore = true;

            this.clearInput(input);

            const dir = await this.getCurrentWorkingDir();
            const fullPath = path.join(dir, relativePath);

            const sftp = await this.getSFTP();
            await sftp.fastGetAsync(fullPath, path.basename(fullPath), {});

            process.stdout.write(`Downloaded ${fullPath}`);
        } catch (err) {
            if (err.message === 'No such file') {
                process.stdout.write(`File not found`);
            } else {
                throw err;
            }
        } finally {
            this.ignore = false;
            this.stream.write('\n');
        }
    }

    async putCommand(input, relativeLocalPath) {
        try {
            this.ignore = true;

            this.clearInput(input);

            const dir = await this.getCurrentWorkingDir();
            const remoteFullPath = path.join(dir, path.basename(relativeLocalPath));

            const sftp = await this.getSFTP();
            await sftp.fastPutAsync(relativeLocalPath, remoteFullPath, {});

            process.stdout.write(`Uploaded ${relativeLocalPath}`);
        } catch (err) {
            if (err.message.startsWith('ENOENT')) {
                process.stdout.write(`File not found`);
            } else if (err.message.startsWith('EISDIR')) {
                process.stdout.write('Sorry, recursive put is not supported')
            } else {
                throw err;
            }
        } finally {
            this.ignore = false;
            this.stream.write('\n');
        }
    }
};
