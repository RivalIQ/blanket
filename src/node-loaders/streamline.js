var fs = require("fs");

module.exports = function(blanket){
    var oldLoaderSL = require.extensions['._js'];

    require.extensions['._js'] = function(localModule, filename) {
        var pattern = blanket.options("filter");
        var antiPattern = blanket.options("antifilter");

        filename = blanket.normalizeBackslashes(filename);

        // determine whether this file should be instrumented or not per
        // the filter, if it was specified
        var isFiltered = (typeof antiPattern !== "undefined" && blanket.matchPattern(filename, antiPattern));

        if (blanket.matchPattern(filename,pattern) && !isFiltered) {
            var content = fs.readFileSync(filename, 'utf8');
            blanket.instrument({
                inputFile: content,
                inputFileName: filename
            },function(instrumented){
                try{
                    oldLoaderSL(localModule, filename, instrumented);
                }
                catch(err){
                    console.log("Error parsing instrumented code: "+err);
                }
            });
        } else{
            oldLoaderSL(localModule, filename);
        }
    };
};