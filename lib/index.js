const HttpStatus = require('http-status-codes');
const circuitBreaker = require('opossum');
const Brakes = require('brakes');
const globalStats = Brakes.getGlobalStats();
const DEFAULT_CIRCUIT_BREAKER = 'opossum';

function onFailure(error) {
  if (error.status === 500) {
    return true;
  }
  return false;
}

/**
 * create hystrix command
 * @param  {Function} func function to execute
 * @param  {Object} service service object
 * @return {Function} returns generated hystrix command
 */
function createServiceCommand(func, service, functionName, circuitBreakerImpl = DEFAULT_CIRCUIT_BREAKER) {

  let name = func.name && service && service.name && !service.name.includes(':') && !service.name.includes(func.name)
    ? `${service.name}:${func.name}`
    : service && service.name && func.name && !service.name.includes(func.name)
      ? `${service.name}:${func.name}`
      : service && service.name;

  if (functionName && !name.includes(functionName)) {
    name = `${service.name}:${functionName}`;
  }

  const options = {
    timeout: service && service.timeout || 3000, // If our function takes longer than 3 seconds, trigger a failure
    errorThresholdPercentage: service && service.errorThreshold || 50, // When 50% of requests fail, trip the circuit
    resetTimeout: service && service.cbsleep || 3000, // After 30 seconds, try again.
    rollingCountTimeout: service && service.statisticalWindowLength || 10000,
    rollingCountBuckets: service && service.statisticalWindowNumberOfBuckets || 10,
    name: name,
    capacity: service && service.cbRequestVolume || 10,
    circuitDuration: service && service.cbsleep || 3000,
    bucketNum: service && service.statisticalWindowNumberOfBuckets || 10,
    threshold: service && service.errorThreshold || 0.5,
    isFailure: service && service.isFailure || onFailure,
    failure: service && service.isFailure || onFailure,
    modifyError: false
  };

  if (circuitBreakerImpl === 'opossum') {
    return circuitBreaker(
      func,
      options
    );
  }
  return new Brakes(
    func,
    options
  );

}

/**
 * create an object of executable hystrix commands
 * @param  {Object} hystrixFunctions Objetc of hystrix functions
 * @return {Object} of executable hystrix commands
 */
function createExecutableCommands(hystrixFunctions, circuitBreakerImpl = DEFAULT_CIRCUIT_BREAKER) {
  const executeFunctions = {};
  const executeFns = Object.keys(hystrixFunctions);

  executeFns.forEach((fn) => {
    executeFunctions[fn] = async (...args) => {
      return circuitBreakerImpl === 'opossum'
        ? await hystrixFunctions[fn].fire(...args)
        : await hystrixFunctions[fn].exec(...args);
    };
  });
  return executeFunctions;
}

/**
 * create and returns hystrix functions
 * @param  {Object} fn list of functions to generate commands for. fn can be of type Array of functions or Function
 * @param  {Object} service config service object
 * @return {Object} hystrix functions
 */
function createHystrixCommands(fn, service, circuitBreakerImpl = DEFAULT_CIRCUIT_BREAKER) {
  const hystrixFunctions = {};
  const serviceFns = Object.keys(fn);

  if (typeof fn === 'function') {
    hystrixFunctions[fn.name] = createServiceCommand(fn, service, undefined, circuitBreakerImpl);
  } else if (Array.isArray(fn)) {
    fn.forEach((func) => {
      hystrixFunctions[func.name] = createServiceCommand(func, service, undefined, circuitBreakerImpl);
    });
  } else if (typeof fn === 'object') {
    serviceFns.forEach((func) => {
      hystrixFunctions[func] = createServiceCommand(fn[func], service, func, circuitBreakerImpl);
    });
  } else {
    throw 'Parameter is not a function!';
  }
  return createExecutableCommands(hystrixFunctions, circuitBreakerImpl);
}


function getPrometheusStream(circuitBreakerImpl = DEFAULT_CIRCUIT_BREAKER) {

  return circuitBreakerImpl === 'opossum'
    ? circuitBreaker.stats
    : globalStats.getHystrixStream();
}

function createHystrixStream(app, path = '/manage/hystrix.stream', circuitBreakerImpl = DEFAULT_CIRCUIT_BREAKER) {

  app.get(path, (req, res) => {

    res.setHeader('Content-Type', 'text/event-stream;charset=UTF-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    if (circuitBreakerImpl === 'opossum') {
      circuitBreaker.stats.pipe(res);
    } else {
      globalStats.getHystrixStream().pipe(res);
    }

  });
}


module.exports = {
  createHystrixCommands,
  createHystrixStream,
  getPrometheusStream
};
