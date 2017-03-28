'use strict';

const LogService = require('../core/LogService');
const AutoScaleService = require('../core/AutoScaleService');
const AutoScaleConfigRepository = require('../core/AutoScaleConfigRepository');

const awsOptions = { region: process.env.REGION };

module.exports.index = (event, context, callback) => {
  const service = new AutoScaleService(
    awsOptions,
    new AutoScaleConfigRepository(awsOptions),
    new LogService(awsOptions)
  );

  service.scaleUpTables()
    .then(context.succeed)
    .catch(context.fail);
};
