const nodeExternals = require('webpack-node-externals');

module.exports = function (options, webpack) {
    return {
        ...options,
        externals: [
            nodeExternals({
                allowlist: [
                    /^otplib/,
                    /^@otplib/,
                    /^@scure/,
                    /^axios/ // Bundle axios too just in case
                ],
            }),
        ],
    };
};
