'use strict';

var rootDir = __dirname + '/../';
var log = require(rootDir + 'log');
var config = require(rootDir + 'config');
var bitcoinRpc = require(rootDir + 'lib/bitcoinrpc');
var paymentsLib = require(rootDir + 'lib/payments');
var db = require(rootDir + 'db');
var async = require('async');
var lastBlockHash, lastBlockJobTime; // Milliseconds since previous lastBlockJob

function findPastValidBlock(blockHash, cb) {
  bitcoinRpc.getBlock(blockHash, function(err, block) {
    if (block && block.error && block.error.code && block.error.code === -5) {
      log.fatal('Fatal Error: Blockhash ' + blockHash + ' is not known to bitcoind.  This should never happen.');
      process.exit(255);
    }
    else if (err) {
      return cb(err, null);
    }
    block = block.result;
    if (block.confirmations === -1) {
      // NOTE: Reorg and double-spent handling is in updatePaymentWithTransaction.
      findPastValidBlock(block.previousblockhash, cb);
    }
    else {
      // Success
      cb(null, blockHash);
    }
  });
}

function findGenesisBlock(cb) {
  bitcoinRpc.getBlockHash(0, function(err,info) {
    if (err) {
      return cb(err);
    }
    else {
      cb(null, info.result);
    }
  });
}

// Determine blockHash safe for listSinceBlock
function pickPastBlockHash(cb) {
  if (lastBlockHash) {
    // Use lastBlockHash already known to Baron
    cb(null, lastBlockHash);
  }
  else {
    db.getLatestPaymentWithBlockHash(function(err,payment) {
      if (payment) {
        // Startup: attempt to find recent blockhash from the latest paid transaction
        findPastValidBlock(payment.blockhash, function(err, blockHash) {
          if (err) {
            cb(err);
          }
          else {
            log.info('lastBlockHash Initialized: ' + blockHash);
            cb(null, blockHash);
          }
        });
      }
      else {
        // Not found, set to genesis so listSinceBlock does not miss any transactions
        findGenesisBlock(function(err, blockHash) {
          if (err) {
            cb(err);
          }
          else {
            log.info('lastBlockHash Initialized from Genesis: ' + blockHash);
            cb(null, blockHash);
          }
        });
      }
    });
  }
}

// Update all transactions from bitcoind that happened since blockHash
function updatePaymentsSinceBlock(blockHash, cb) {
  bitcoinRpc.listSinceBlock(blockHash, function (err, info) {
    if (err) {
      return cb(err);
    }
    info = info.result;
    var transactions = [];
    info.transactions.forEach(function(transaction) {
      if (transaction.category === 'receive') { // we only care about received transactions
        transactions.push(transaction);
      }
    });
    var newBlockHash = info.lastblock;
    async.eachSeries(transactions, function(transaction, cbSeries) {
      paymentsLib.updatePayment(transaction, function() {
        cbSeries(); // We dont care if update fails just run everything in series until completion
      });
    },
    function() {
      if (blockHash !== newBlockHash) {
        cb(null, newBlockHash);
      }
      else {
        cb(null, blockHash);
      }
    });
  });
}

var lastBlockJob = function(callback) {
  var currentTime = new Date().getTime();
  // Skip lastBlockJob if previous was less than 1 second ago
  if (!lastBlockJobTime || currentTime > lastBlockJobTime + 1000) {
    lastBlockJobTime = currentTime;
    async.waterfall([
      function(cb) {
        pickPastBlockHash(cb);
      },
      function(blockHash, cb) {
        log.debug('updatePaymentsSinceBlock:  ' + blockHash);
        updatePaymentsSinceBlock(blockHash, cb);
      }
      ], function(err, blockHash) {
        if (err) {
          log.error(err, 'lastBlockJob Error');
        }
        else if (blockHash) {
          lastBlockHash = blockHash;
        }
        if (callback) {
          callback();
        }
    });
  }
  else {
    if (callback) {
      callback();
    }
  }
};

var runLastBlockJob = function () {
  setInterval(function(){
    lastBlockJob();
  }, config.lastBlockJobInterval);
  log.info('Baron Init: lastBlockJob running every ' + (config.lastBlockJobInterval / 1000) + ' seconds.');
};

module.exports = {
  runLastBlockJob: runLastBlockJob,
  lastBlockJob: lastBlockJob,
};
