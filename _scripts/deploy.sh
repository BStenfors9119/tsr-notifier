#!/bin/bash

lftp -u tsradmin,Zoipdrazz324? sftp://tsradmin@10.24.3.46 <<EOF
cd ~/web
put ./tsr-notifier.tar
exit
EOF
