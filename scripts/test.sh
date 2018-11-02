mkdir ./test/.ara
cp ./test/.ararc ./.ararc 
ava test --verbose
rm ./.ararc
rm -rf ./test/.ara