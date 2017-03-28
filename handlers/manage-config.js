'use strict';

const AutoScaleConfigRepository = require('../core/AutoScaleConfigRepository.js');
const ddbOptions = { region: process.env.REGION };

function response(callback) {
  return {
    send: function (promise) {
      promise
        .then(data => callback(null, {
          statusCode: 200,
          body: JSON.stringify(data),
        })).catch(err => callback(err));
    }
  };
}

module.exports.load = (event, context, callback) => {
  const repository = new AutoScaleConfigRepository(ddbOptions);
  response(callback).send(repository.load());
};

module.exports.fetch = (event, context, callback) => {
  const repository = new AutoScaleConfigRepository(ddbOptions);
  response(callback).send(repository.fetch(event.pathParameters.tableName));
};

module.exports.save = (event, context, callback) => {
  const body = JSON.parse(event.body);
  const repository = new AutoScaleConfigRepository(ddbOptions);
  response(callback).send(repository.save(body));
};

module.exports.delete = (event, context, callback) => {
  const repository = new AutoScaleConfigRepository(ddbOptions);
  response(callback).send(repository.delete(event.pathParameters.tableName));
};