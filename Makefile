.SILENT :

APPNAME:=node-red-contrib-keeper

RUN_CUSTOM_FLAGS?=-p 1880:1880 -e NODE_ENV=development

include $(PWD)/dockerfiles/_Makefile

