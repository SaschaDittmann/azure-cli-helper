var log = require('winston');

log.info('         _    _____   _ ___ ___'.cyan);
log.info('        /_\\  |_  / | | | _ \\ __|'.cyan);
log.info('  _ ___'.grey + '/ _ \\'.cyan + '__'.grey + '/ /| |_| |   / _|'.cyan + '___ _ _'.grey);
log.info('(___  '.grey + '/_/ \\_\\/___|\\___/|_|_\\___|'.cyan + ' _____)'.grey);
log.info('   (_______ _ _)         _ ______ _)_ _ '.grey);
log.info('          (______________ _ )   (___ _ _)'.grey);
log.info('');

if (process.argv.length === 2) {
    log.info('Syntax des Synchronisationsskript:'.cyan)
    log.info('node wamssync.js [Dienstname] [Verzeichnis]')
    return;
}

var fs = require('fs');
var util = require('util');
var exec = require('child_process').exec;
var serviceName = process.argv[2];
var directory = process.argv[3] || __dirname;

log.info('Mobile Service Name: '.cyan + serviceName);
log.info('Synchronisationsverzeichnis: '.cyan + directory);

fs.exists(directory, function (exists) {
  if (!exists) {
    log.info('Erzeuge Synchronisationsverzeichnis.');
    fs.mkdir(directory, function(){
      checkServiceName();
    });
  }
  else {
    checkServiceName();
  }
})

function checkServiceName() {
  var serviceFound;
  log.info('Lade Dienstübersicht.');
  executeJsonCmd("azure mobile list " + serviceName, function(error, scripts) {
    if (error) {
      log.error(error.red);
      return;
    }
    scripts.forEach(function(svc){
      if (svc.name === serviceName && svc.state === 'Ready') {
        listAndDownloadScripts();
        serviceFound = true;
      }
    });
    if (!serviceFound) {
      log.error(util.format('Ein Dienst mit dem Namen %s konnte nicht gefunden werden.', serviceName).red);
      return;
    }
  });
}

function listAndDownloadScripts() {
  // first, download all the list of scripts and place them into the directory. 
  // Overwrite if necessary.
  log.info('Lade Skriptübersicht.');
  executeJsonCmd("azure mobile script list " + serviceName, function(error, scripts) {
    if (error) {
      log.error(error.red);
      return;
    }

    // we're only interested in table scripts for now
    var tableScripts = scripts.table;
    var downloadCount = 0;

    for (var i=0; i < tableScripts.length; i++) {
      var table = tableScripts[i];
      downloadScript(table, function(err) {
        if (err) {
          log.error(err.red);
        }
        else {
          downloadCount++;
          if (downloadCount == scripts.table.length) {
            startWatch();
          }
        }
      });
    }
  });
}

// downloads a particular script and saves it to disk
function downloadScript(table, callback) {
  log.info(util.format('Starte Download für das %s-Skript der %s-Tabelle.', table.operation, table.table));
  var file = util.format("%s.%s.js", table.table, table.operation)
  executeJsonCmd(util.format('azure mobile script download --override -f "%s/%s" %s table/%s', directory, file, serviceName, file),
  function(err, script) {
    log.info('Download erfolgreich abgeschlossen: '.green + util.format(' %s/%s', directory, file).grey);
    callback(err);
  });
}

// starts the file watch and uploads any changed files
function startWatch() {
  var watch = require('./node_modules/watch');

  watch.createMonitor(directory, {
   'ignoreDotFiles' : true
  },
  function (monitor) {
    log.info(util.format('Starte Überwachung des %s-Verzeichnisses.', directory));
    log.info('(Zum Beenden ^C drücken)');
    monitor.on("created", function (f, stat) {
      log.info(util.format('Lade neue Datei (%s) hoch.', f));
      executeJsonCmd(util.format("azure mobile script upload -f %s %s table/%s", f, serviceName, f.split(/[/\\]+/).pop().replace(/.js/,"")), function(err) {
        if (err) log.error(err.red);
        else { log.info(util.format("Hochladen der Datei %s war erfolgreich.", f).green); }
      });
    });
    monitor.on("changed", function (f, curr, prev) {
      log.info(util.format('Lade geänderte Datei (%s) hoch.', f));
      executeJsonCmd(util.format("azure mobile script upload -f %s %s table/%s", f, serviceName, f.split(/[/\\]+/).pop().replace(/.js/,"")), function(err) {
        if (err) log.error(err.red);
        else { log.info(util.format("Hochladen der Datei %s war erfolgreich.", f).green); }
      });
    });
    monitor.on("removed", function (f, stat) {
      log.info(util.format('Entferne Datei (%s) aus dem Dienst.', f));
      executeJsonCmd(util.format("azure mobile script delete %s table/%s", serviceName, f.split(/[/\\]+/).pop().replace(/.js/,"")), function(err) {
        if (err) log.error(err.red);
        else { log.info(util.format("Datei %s wurde erfolgreich entfernt.", f).green); }
      });
    });
  })
}

// This little function can be used to help invoke the
// CLI on a child process. It always appends --json to the
// specified command and attempts to parse a non-error body
// into JavaScript objects to pass to the callback
function executeJsonCmd(cmd, callback) {
    exec(cmd + " --json", function(err, stdout, stderror) {
        if (err) {
            callback(err);
        }
        else if (stderror) {
            callback(stderror);
        }
        else {
            if (stdout) {
                callback(null, JSON.parse(stdout));
            }
            else {
                callback(null, null);
            }
        }
    });
}