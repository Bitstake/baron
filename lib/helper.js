'use strict';

var rootDir = __dirname + '/../';
var log = require(rootDir + 'log');
var config = require(rootDir + 'config');
var _ = require('lodash');
var BigNumber = require('bignumber.js');
var crypto = require('crypto');

// returns decimal places of provided
var decimalPlaces = function(number) {
  var numStr = number.toString();
  if(Math.floor(number) === number || numStr.indexOf('+') > -1) {
    return 0;
  }
  if (numStr.indexOf('-') > -1) {
    return numStr.split('-')[1];
  }
  var decimalDigits = numStr.split('.')[1];
  return decimalDigits ? decimalDigits.length : 0;
};

// Truncates a number to four decimal places 
var toFourDecimals = function(number) {
  number = Number(number).toFixed(8).toString();
  var numberArr = number.toString().split('.');
  return numberArr[0] + '.' + numberArr[1].substring(0, 4);
};

// Assuming number with 8 decimal places, returns last four digits
var getLastFourDecimals = function(number) {
  number = Number(number).toFixed(8).toString();
  return number.split('.')[1].substring(4, 8);
};

// Round to decimal place
var roundToDecimal = function(number, decimalPlaces) {
  return Number(Math.round(number + 'e+' + decimalPlaces)  + 'e-' + decimalPlaces).toFixed(decimalPlaces);
};

// Returns receiveDetail portion of transaction json from wallet notify
var getReceiveDetails = function(details) {
  var receiveDetails = {};
  details.forEach(function(detail) {
    if(detail.category === 'receive') {
      if (receiveDetails[detail.address]) {
        var amount = receiveDetails[detail.address].amount;
        detail.amount = detail.amount + amount;
      }
      receiveDetails[detail.address] = detail;
    }
  });
  return _.values(receiveDetails);
};

// Returns the difference in days, hours, mins, and secs between parameter
var getExpirationCountDown = function (expiration) {
  var curTime = new Date().getTime();
  var diff = expiration - curTime;
  var days = Math.floor(diff / 1000 / 60 / 60 / 24);
  diff -= days * 1000 * 60 * 60 * 24;
  var hours = Math.floor(diff / 1000 / 60 / 60);
  diff -= hours * 1000 * 60 * 60;
  var mins = Math.floor(diff / 1000 / 60);
  diff -= mins * 1000 * 60;
  var secs = Math.floor(diff / 1000);
  if (days === 0 && hours !== 0) {
    return hours + 'h ' + mins + 'm ' + secs + 's';
  }
  else if (days === 0 && hours === 0) {
    return mins + 'm ' + secs + 's';
  }
  else {
    return days + 'd ' + hours + 'h ' + mins + 'm ' + secs + 's';
  }
};

// Returns status of payment
var getPaymentStatus = function(payment, confirmations, invoice) {
  confirmations = confirmations ? confirmations : 0; // Pending if there are no confs
  var minConfirmations = invoice.min_confirmations;
  var status = payment.status;
  var confirmationsMet = Number(confirmations) >= Number(minConfirmations);
  var expectedAmount = new BigNumber(payment.expected_amount);
  var amountPaid = new BigNumber(payment.amount_paid);
  if (confirmations === -1) {
    status = 'invalid';
  }
  else if (amountPaid.greaterThan(0) && !confirmationsMet) {
    status = 'pending';
  }
  else if (confirmationsMet) {
    var isUSD = invoice.currency.toUpperCase() === 'USD';
    var closeEnough = false;
    if (isUSD) {
      var actualPaid = new BigNumber(payment.amount_paid).times(payment.spot_rate);
      var expectedPaid = new BigNumber(payment.expected_amount).times(payment.spot_rate);
      actualPaid = roundToDecimal(actualPaid.valueOf(), 2);
      expectedPaid = roundToDecimal(expectedPaid.valueOf(), 2);
      closeEnough = new BigNumber(actualPaid).equals(expectedPaid);
    }
    if(amountPaid.equals(expectedAmount) || closeEnough) {
      status = 'paid';
    }
    else if (amountPaid.lessThan(expectedAmount)) {
      status = 'partial';
    }
    else if (amountPaid.greaterThan(expectedAmount)) {
      status = 'overpaid';
    }
  }
  return status;
};

function csvToArray(csv) {
  var array = csv.split(',');
  var results = [];
  array.forEach(function(element) {
    results.push(element.trim());
  });
  return results;
}

var getInvalidEmail = function(txid, invoiceId) {
  var invoiceUrl = config.publicURL + '/invoices/' + invoiceId;
  var subject = '[' + config.appTitle + '] Invalid Tx in Invoice ' + invoiceId;
  var body = 'Transaction ' + txid + ' has been double-spent rendering it invalid, please ' +
    'check <a href="' + invoiceUrl + '" target="_blank">Invoice ' + invoiceId + '</a>.';
  var email = {
    from: config.senderEmail,
    to: csvToArray(config.adminEmails),
    subject: subject,
    html: body
  };
  log.info('Notifying admin of invalid transaction in invoice ' + invoiceId);
  return email;
};

// Return string of len characters of pseudorandom hex
var pseudoRandomHex = function(len) {
  return crypto.pseudoRandomBytes(Math.ceil(len/2)).toString('hex').slice(0,len);
};

module.exports = {
  decimalPlaces: decimalPlaces,
  toFourDecimals: toFourDecimals,
  getLastFourDecimals: getLastFourDecimals,
  roundToDecimal: roundToDecimal,
  getReceiveDetails: getReceiveDetails,
  getExpirationCountDown: getExpirationCountDown,
  getPaymentStatus: getPaymentStatus,
  getInvalidEmail: getInvalidEmail,
  pseudoRandomHex: pseudoRandomHex
};