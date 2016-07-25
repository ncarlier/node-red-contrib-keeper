.SILENT :

APPNAME:=node-red-contrib-keeper

RUN_CUSTOM_FLAGS?=-p 1880:1880

include $(PWD)/dockerfiles/_Makefile

