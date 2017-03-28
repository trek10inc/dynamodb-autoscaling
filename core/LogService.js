'use strict';

class LogService {

  constructor() {

  }

  log() {
    console.log.apply(console, arguments);
  }
}

module.exports = LogService;
