var fs = require("fs");

module.exports = function(blanket){
    var oldLoaderSL = require.extensions['._js'];

    require.extensions['._js'] = function(localModule, filename) {
        var pattern = blanket.options("filter");
        filename = blanket.normalizeBackslashes(filename);
        if (blanket.matchPattern(filename,pattern)){
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
        }else{
            oldLoaderSL(localModule,filename);
        }
    };
};