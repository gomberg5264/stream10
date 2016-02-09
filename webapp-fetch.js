'use strict';

var fs = require('fs');
var path = require('path');
var del = require('del');
var mkdir = require('mkdirp');
var replace = require('replace');
var chalk = require('chalk');
var exec = require('child_process').exec;
var Promise = require('bluebird');

var manifest = require([process.cwd(), 'webapps.json'].join(path.sep));
var keys = Object.keys(manifest);
var webapps = keys.map(function(key) {
  return Object.assign(manifest[key], {
    name: key,
    workspace: ['', 'tmp', key].join(path.sep)
  });
});

var log = console.log.bind(console);
var distDirectory = [process.cwd(), 'dist'].join(path.sep);
var menuListItemTemplate = '<li><a class="red-text menu-listing-internal" href="/$webappName">$title</a></li>';
var menuListItems = [];
var insertLineRegex = '<!-- webapps -->';

// 1. Clean old build, prep for new build.
var clean = function(options) {
  return new Promise(function(resolve, reject) {
    try {
      del.sync(options.workspace, {force: true});
      mkdir.sync(options.workspace);
      resolve();
    }
    catch(e) {
      reject(e.getMessage());
    }
  });
};
// 2. Git init the newly prepped resource directory to build webapp.
var init = function(options) {
  return new Promise(function(resolve, reject) {
    log(chalk.white('Initializing new webapp build for ' + options.name + '...'));
    var child = exec('git init', options, function(err) {
      if(err) {
        reject(err);
      }
      else {
        resolve({
          child: child
        });
      }
    });
    child.stdout.pipe(process.stdout);
  });
};
// 3. Git remote add aliased repository.
var addRemote = function(options) {
  return new Promise(function(resolve, reject) {
    log(chalk.white('Setting up new webapp build for ' + options.name + ' from ' + options.repositoryUrl + '...'));
   var child = exec(['git remote add', options.name, options.repositoryUrl].join(' '), options, function(err) {
      if(err) {
        reject(err);
      }
      else {
        resolve({
          child: child
        });
      }
    });
    child.stdout.pipe(process.stdout);
  });
};
// 4. Fetch the git repository based on aliased name from Step #3.
var fetch = function(options) {
  return new Promise(function(resolve, reject) {
    log(chalk.yellow('Fetching ' + options.name + '...'));
    var child = exec(['git fetch', options.name].join(' '), options, function(err) {
      if(err) {
        reject(err);
      }
      else {
        resolve({
          child: child
        });
      }
    });
    child.stdout.pipe(process.stdout);
  });
};
// 5. Checkout the target branch defined in the webapps.json configuration.
var checkout = function(options) {
  return new Promise(function(resolve, reject) {
    log(chalk.yellow('Checking out branch ' + options.branch + '...'));
    var child = exec('git checkout ' + options.branch, options, function(err) {
      if(err) {
        reject(err);
      }
      else {
          var configFile = [options.cwd, 'configuration.json'].join(path.sep);
          if(!fs.existsSync(configFile)) {
            reject('Could not find configuration file for ' + options.name + ' webapp. Aborting...');
          }
          else {
            resolve({
              child: child,
              config: JSON.parse(fs.readFileSync(configFile).toString())
            });
          }
      }
    });
    child.stdout.pipe(process.stdout);
  });
};
// 6. Run the opitonal build command found in the configuration of the webapp repo.
var buildWebapp = function(options) {
  return new Promise(function(resolve, reject) {
    if(options.cmd) {
      const command = chalk.magenta([options.cwd, options.cmd].join(' $'));
      log(
        chalk.yellow('Building ' + options.name + ' using ' + command + '...')
      );
      var child = exec(options.cmd, options, function(err) {
        if(err) {
          reject(err);
        }
        else {
          var output = [options.cwd, options.outDir].join(path.sep);
          try {
            log(chalk.white('Exists? ' + output));
            log(chalk.white(JSON.stringify(fs.statSync(output), null, 2)));
            resolve({
              child: child
            });
          }
          catch(e) {
            log(chalk.red('Output path does not exist.'));
            reject(e);
          }
        }
      });
      child.stdout.pipe(process.stdout);
    }
    else {
      resolve();
    }
  });
};

var moveWebapp = function(options) {
  return new Promise(function(resolve, reject) {
    const outDir = chalk.magenta(options.outDir);
    const toDir = chalk.magenta(options.toDir);
    log(
      chalk.white('Moving ' + outDir + ' to ' + toDir + '...')
    );
    var child = exec(['mv', options.outDir, options.toDir].join(' '), options, function(err) {
      if(err) {
        reject(err);
      }
      else {
        resolve({
          child: child
        });
      }
    });
    child.stdout.pipe(process.stdout);
  });
};

var generate = function() {

  Promise.each(webapps, function(config) {

    console.log(chalk.blue('Generating WebApp with config:\n' + JSON.stringify(config, null, 2)));

    return clean(config)
    .then(function(res) {
      return init({
        cwd: config.workspace,
        name: config.name
      });
    })
    .then(function() {
      return addRemote({
        cwd: config.workspace,
        name: config.name,
        repositoryUrl: config.repositoryUrl
      });
    })
    .then(function() {
      return fetch({
        cwd: config.workspace,
        name: config.name
      });
    })
    .then(function() {
      return checkout({
        branch: config.branch,
        cwd: config.workspace,
        name: config.name
      });
    })
    .then(function(res) {
      config = Object.assign(config, res.config);
      log(chalk.blue('Updated configuration: ' + JSON.stringify(config, null, 2)));
      return buildWebapp({
        cwd: config.workspace,
        name: config.name,
        cmd: config.buildCommand,
        outDir: config.webappOutput
      });
    })
    .then(function() {
      return moveWebapp({
        cwd: config.workspace,
        name: config.name,
        outDir: config.webappOutput,
        toDir: [distDirectory, 'webapps', config.webappName].join(path.sep)
      });
    })
    .then(function() {
      var entry = menuListItemTemplate.replace('$webappName', config.webappName).replace('$title', config.title);
      menuListItems.push(entry);
      log(chalk.blue('Build complete for ' + config.name + '.'));
    })
    .catch(function(e) {
      log(chalk.red('Error: ' + e));
    });

  }).
  then(function() {
    // 1. Update src/template/partial/menu with menuListItems...
    replace({
      regex: insertLineRegex,
      replacement: menuListItems.join('/r/n'),
      paths: [[process.cwd(), 'src', 'template', 'partial', 'menu.hbs'].join(path.sep)],
      recursive: false,
      silent: false
    });
    // 2. Generate build.
  });
};

var child = exec('npm run build', {cwd:process.cwd()}, function(err) {
  if(err) {
    log(chalk.red('Error in building: ' + err));
  }
  else {
    generate();
  }
});
child.stdout.pipe(process.stdout);
