set -e
set -x

archs=(linux-arm64 linux-armv7 linux-x64)

cd scripts
mkdir -p ../prebuilds_tmp
for arch in "${archs[@]}"
do
	echo "$arch "
  sed "s/_ARCH_/$arch/g" ./Dockerfile-cross-nodejs-build > ./Dockerfile
  docker build -t nodejs-cross-build-$arch .
  docker run --rm nodejs-cross-build-$arch > ./dockcross
  chmod +x ./dockcross
  cd ../
  ./scripts/dockcross bash -c "npm run build:release"
  cd prebuilds
  for file in `ls`
  do
    mv $file ../prebuilds_tmp/${file/linux-x64/$arch}
  done
  cd ..
  rm -rf ./prebuilds
  cd scripts
  rm ./Dockerfile ./dockcross
done
mkdir ../prebuilds
mv ../prebuilds_tmp/* ../prebuilds
rm -rf ../prebuilds_tmp
