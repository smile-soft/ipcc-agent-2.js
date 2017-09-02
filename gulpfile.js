var gulp = require('gulp');
var source = require('vinyl-source-stream');
var streamify = require('gulp-streamify');
var uglify = require('gulp-uglify');
var rename = require('gulp-rename');
var notify = require('gulp-notify');
var browserify = require('browserify');

var basePath = {
	src: 'source/',
	dest: './',
	test: 'test/'
};

gulp.task('browserify', function() {
	var bundleStream = browserify(basePath.src+'main.js', {
		standalone: 'SmileSoft',
		bundleExternal: false,
		debug: true
	}).bundle();

	bundleStream
	.pipe(source(basePath.src+'main.js'))
	.pipe(rename('ipcc-agent.js'))
	.pipe(gulp.dest(basePath.dest))
	.pipe(streamify(uglify()))
	.pipe(rename({suffix: '.min'}))
	.pipe(gulp.dest(basePath.dest))
	.pipe(notify({ message: 'browserify task complete' }));
});

gulp.task('build', function() {
	gulp.start(['browserify', 'test']);
});

gulp.task('default', function() {
	gulp.start('build');
});

gulp.task('test', function() {
	return gulp.src(basePath.dest+'ipcc-agent.js')
	.pipe(gulp.dest(basePath.test+'js/'));
});
