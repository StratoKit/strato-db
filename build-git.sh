#!/bin/sh
BUILDDIR=dist

function die() {
	echo "!!! $* !!!" >&2
	exit 1
}
if ! git diff --quiet; then
	die Repo is not clean
fi

CURRENT=`git branch --no-color 2> /dev/null | sed -e '/^[^*]/d' -e 's/^\* //'`
ORIGIN=`git config branch.$CURRENT.remote`
if [ -z "$ORIGIN" ]; then
	die "Cannot determine origin, are you on a branch?"
fi
if [ $1 ]; then
	CURRENT=$1
fi
B=${CURRENT}-build
echo "=== Building and pushing to $ORIGIN/$B ==="

if ! nps test; then
	die Tests failed
fi
if ! nps build; then
	die Could not build
fi
if ! git add -f $BUILDDIR; then
	die Could not add to commit
fi
if ! git commit -m build; then
	die Could not commit
fi

function clean() {
	# This undoes the last commit but leaves the build in place
	git reset HEAD^
}

if ! git push -f "$ORIGIN" "HEAD:$B"; then
	clean
	die Could not push to $ORIGIN/$B
fi

if ! clean; then
	die Could not clean temporary commit
fi
