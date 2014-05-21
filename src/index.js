var extend = require("xtend"),
    path = require('path'),
    join = path.join;


var blanketNode = function (userOptions,cli){

    var fs = require("fs"),
        path = require("path"),
        configPath = process.cwd() + '/package.json',
        existsSync = fs.existsSync || path.existsSync,
        file = existsSync(configPath) ? JSON.parse((fs.readFileSync(configPath, 'utf8')||{})) : null,
        packageConfigs;

    if (file){
        var scripts = file.scripts,
            config = file.config;

        if (scripts && scripts.blanket){
            console.warn("BLANKET-" + path + ": `scripts[\"blanket\"]` is deprecated. Please migrate to `config[\"blanket\"]`.\n");
            packageConfigs = scripts.blanket;
        } else if (config && config.blanket){
            packageConfigs = config.blanket;
        }
    }

    var blanketConfigs = packageConfigs ? extend(packageConfigs,userOptions) : userOptions,
        blanket = require("./blanket").blanket,
        loaders = {},
        pattern,
        extensions,
        compilers;

    if (blanketConfigs) {
        pattern = blanketConfigs.pattern;
        extensions = blanketConfigs.extensions;
        compilers = blanketConfigs.compilers;
    }

    if (!pattern) {
        pattern = "src";
    }

    if (!extensions) {
        extensions = ['.js'];
    }

    if (!compilers) {
        compilers = {};
    }

    extensions.forEach(function (extension) {
       loaders[extension] = {
           newLoader: null,
           oldLoader: require.extensions[extension]
       };
    });

    function escapeRegExp(str) {
        return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
    }
    if (blanketConfigs){
        var newOptions={};
        Object.keys(blanketConfigs).forEach(function (option) {
            var optionValue = blanketConfigs[option];
            if(option === "data-cover-only" || option === "pattern"){
                newOptions.filter = optionValue;
            }
            if(option === "data-cover-never"){
                newOptions.antifilter = optionValue;
            }
            if (option === "data-cover-loader" || option === "loader"){
                newOptions.loader = optionValue;
            }
            if (option === "data-cover-timeout"){
                newOptions.timeout = optionValue;
            }
            if (option === "onlyCwd" && !!optionValue){
                newOptions.cwdRegex = new RegExp("^" + escapeRegExp(process.cwd()), "i");
            }
            if (option === "data-cover-customVariable"){
                newOptions.customVariable = optionValue;
            }
            if (option === "data-cover-flags"){
                newOptions.order = !optionValue.unordered;
                newOptions.ignoreScriptError = !!optionValue.ignoreError;
                newOptions.autoStart = !!optionValue.autoStart;
                newOptions.branchTracking = !!optionValue.branchTracking;
                newOptions.debug = !!optionValue.debug;
                newOptions.engineOnly = !!optionValue.engineOnly;
            }
            if (option === "data-cover-reporter-options"){
                newOptions.reporter_options = optionValue;
            }
        });
        blanket.options(newOptions);
    }

    //helper functions
    blanket.normalizeBackslashes = function (str) {
        return str.replace(/\\/g, '/');
    };

    blanket.restoreNormalLoader = function () {
        if (!blanket.options("engineOnly")){
            extensions.forEach(function (extension) {
                var config = loaders[extension];
                config.newLoader = require.extensions[extension];
                require.extensions[extension] = config.oldLoader;
            });
        }
    };

    blanket.restoreBlanketLoader = function () {
        if (!blanket.options("engineOnly")){
            extensions.forEach(function (extension) {
                var config = loaders[extension];
                require.extensions[extension] = config.newLoader;
            });
        }
    };

    //you can pass in a string, a regex, or an array of files
    blanket.matchPattern = function (filename,pattern){
        var cwdRegex = blanket.options("cwdRegex");
        if (cwdRegex && !cwdRegex.test(filename)){
            return false;
        }
        if (typeof pattern === 'string'){
            if (pattern.indexOf("[") === 0){
                    //treat as array
                var pattenArr = pattern.slice(1,pattern.length-1).split(",");
                return pattenArr.some(function(elem){
                    return blanket.matchPattern(filename,blanket.normalizeBackslashes(elem.slice(1,-1)));
                });
            }else if ( pattern.indexOf("//") === 0){
                var ex = pattern.slice(2,pattern.lastIndexOf('/'));
                var mods = pattern.slice(pattern.lastIndexOf('/')+1);
                var regex = new RegExp(ex,mods);
                return regex.test(filename);
            }else{
                return filename.indexOf(blanket.normalizeBackslashes(pattern)) > -1;
            }
        }else if ( pattern instanceof Array ){
            return pattern.some(function(elem){
                return filename.indexOf(blanket.normalizeBackslashes(elem)) > -1;
            });
        }else if (pattern instanceof RegExp){
            return pattern.test(filename);
        }else if (typeof pattern === 'function'){
            return pattern(filename);
        }else{
            throw new Error("Bad file instrument indicator.  Must be a string, regex, function, or array.");
        }
    };
    if (!blanket.options("engineOnly")){
        extensions.forEach(function (extension) {
            var config = loaders[extension];
            var oldLoader = config.oldLoader;

            require.extensions[extension] = function(localModule, filename) {
                var pattern = blanket.options("filter"),
                    regex = new RegExp("\\. + " + extension + "$"),
                    reporter_options = blanket.options("reporter_options"),
                    originalFilename = filename;
                filename = blanket.normalizeBackslashes(filename);

                //we check the never matches first
                var antipattern = _blanket.options("antifilter");
                if (typeof antipattern !== "undefined" &&
                    blanket.matchPattern(filename.replace(regex,""),antipattern)
                    ){
                    oldLoader(localModule,filename);
                    if (_blanket.options("debug")) {console.log("BLANKET-File will never be instrumented:"+filename);}
                }else if (blanket.matchPattern(filename,pattern)){
                    if (_blanket.options("debug")) {console.log("BLANKET-Attempting instrument of:"+filename);}
                    var content = fs.readFileSync(filename, 'utf8');
                    if (reporter_options && reporter_options.shortnames){
                        filename = filename.replace(process.cwd(),"");
                    }

                    blanket.instrument({
                        inputFile: content,
                        inputFileName: filename
                    },function(instrumented){
                        try{
                            var compiler = compilers[extension];

                            // check to see if a compiler exists for this extension and use it
                            // if it does, otherwise use the default compilation behavior
                            if (typeof compiler === 'function') {
                                compiler(localModule, originalFilename, instrumented);
                            } else {
                                localModule._compile(instrumented, originalFilename);
                            }
                        }
                        catch(err){
                            if (_blanket.options("ignoreScriptError")){
                                //we can continue like normal if
                                //we're ignoring script errors,
                                //but otherwise we don't want
                                //to completeLoad or the error might be
                                //missed.
                                if (_blanket.options("debug")) {console.log("BLANKET-There was an error loading the file:"+filename);}
                                oldLoader(localModule,filename);
                            }else{
                                throw new Error("BLANKET-Error parsing instrumented code: "+err);
                            }
                        }
                    });
                }else{
                    oldLoader(localModule, originalFilename);
                }
            };
        });
    }

    //if a loader is specified, use it
    if (blanket.options("loader")){
        require(blanket.options("loader"))(blanket);
    }

    // iterate over extensions and set up the new loaders
    extensions.forEach(function (extension) {
        var config = loaders[extension];
        config.newLoader = require.extensions[extension];
    });

    return blanket;
};

if ((process.env && process.env.BLANKET_COV===1) ||
    (process.ENV && process.ENV.BLANKET_COV)){
    module.exports = blanketNode({engineOnly:true},false);
}else{
    var args = process.argv;
    var blanketRequired = false;

    for (var i = 0; i < args.length; i++) {
        if (['-r', '--require'].indexOf(args[i]) >= 0 &&
            args[i + 1] === 'blanket') {
            blanketRequired = true;
        }
    }

    if (args[0] === 'node' &&
        args[1].indexOf(join('node_modules','mocha','bin')) > -1 &&
        blanketRequired){

        //using mocha cli
        module.exports = blanketNode(null,true);
    }else{
        //not mocha cli
        module.exports = function(options){
            //we don't want to expose the cli option.
            return blanketNode(options,false);
        };
    }
}





