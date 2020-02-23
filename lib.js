/*!
 * psd2fgui
 * @license [MIT]
 * @copyright http://www.fairygui.com/
 */

"use strict";

const PSD = require('psd');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const xmlbuilder = require('xmlbuilder');

//The group name prefix identified as a component.
const componentPrefix = 'Com';

//The group name prefix identified as a common button.
const commonButtonPrefix = 'Button';

const commonButtonSuffix = 'Btn';

//The group name prefix identified as a checkbox button.
const checkButtonPrefix = 'CheckButton';
const checkBtnSuffix = 'CheckBtn';

//The group name prefix identified as a radio button.
const radioButtonPrefix = 'RadioButton';
const radioBtnSuffix = '@RadioBtn';

const radioGroupSuffix = "@RadioGroup"


//The suffix of slider
const sliderSuffix = 'Slider'

const progressBarSuffix = 'ProBar'
//The layer name suffix of each status of the button.
const buttonStatusSuffix = ['@up', '@down'];


function IsBtn(nodeName)
{
    return nodeName.lastIndexOf(commonButtonSuffix) != -1 && nodeName.lastIndexOf(commonButtonSuffix) == nodeName.length - commonButtonSuffix.length;
}

function IsCheckBtn(nodeName)
{
    return nodeName.lastIndexOf(checkBtnSuffix) != -1 && nodeName.lastIndexOf(checkBtnSuffix) == nodeName.length - checkBtnSuffix.length;
}

function IsRadioBtn(nodeName)
{
    return nodeName.lastIndexOf(radioBtnSuffix) != -1 && nodeName.lastIndexOf(radioBtnSuffix) == nodeName.length - radioBtnSuffix.length;
}

function IsSlider(nodeName)
{
    return nodeName.lastIndexOf(sliderSuffix) != -1 && nodeName.lastIndexOf(sliderSuffix) == nodeName.length - sliderSuffix.length;
}

function IsProgressBar(nodeName)
{
    return nodeName.lastIndexOf(progressBarSuffix) != -1 && nodeName.lastIndexOf(progressBarSuffix) == nodeName.length - progressBarSuffix.length;
}

exports.constants = {
    NO_PACK: 1,
    IGNORE_FONT: 2
};

var targetPackage;


function readFileList(dir, filesList = []) {
    const files = fs.readdirSync(dir);
    files.forEach((item, index) => {
        var fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {      
            readFileList(path.join(dir, item), filesList);  //递归读取文件
        } else {                
            filesList.push(fullPath);                     
        }        
    });
    return filesList;
}

/**
 * Convert a PSD file to a fairygui package.
 * @param {string} psdFile path of the psd file.
 * @param {string} outputFile optional. output file path.
 * @param {integer} option psd2fgui.constants.
 * @param {string} buildId optinal. You can use same build id to keep resource ids unchanged during multiple converting for a psd file.
 * @return {string} output file path.
 */
exports.convert = function (psdFile, outputFile, option, buildId) {
    return new Promise(function (resolve, reject) {
        if (!option)
            option = 0;
        if (!buildId)
            buildId = genBuildId();

        var pathInfo = path.parse(psdFile);
        var outputDirectory;

        if (option & exports.constants.NO_PACK) {
            outputDirectory = outputFile;
            if (!outputDirectory)
                outputDirectory = path.join(pathInfo.dir, pathInfo.name + '-fairypackage');
        }
        else {
            outputDirectory = path.join(pathInfo.dir, pathInfo.name + '~temp');
            fs.emptyDirSync(outputDirectory);

            if (!outputFile)
                outputFile = path.join(pathInfo.dir, pathInfo.name + '.fairypackage');
        }

        var psd = PSD.fromFile(psdFile);
        psd.parse();

        targetPackage = new UIPackage(outputDirectory, buildId);
        targetPackage.exportOption = option;

        createComponent(psd.tree(), pathInfo.name);

        var pkgDesc = xmlbuilder.create('packageDescription');
        pkgDesc.att('id', targetPackage.id);
        var resourcesNode = pkgDesc.ele('resources');
        var savePromises = [];

        targetPackage.resources.forEach(function (item) {
            var resNode = resourcesNode.ele(item.type);

            resNode.att("id", item.id).att("name", item.name).att("path", item.path);

            if (item.type == "image") {
                if (item.scale9Grid) {
                    resNode.att("scale", item.scale);
                    resNode.att("scale9Grid", item.scale9Grid);
                }
                if (!fs.existsSync(path.join(targetPackage.basePath, "Images/"))) {
                    fs.mkdir(path.join(targetPackage.basePath, "Images"),(err) =>{
                        savePromises.push(item.data.saveAsPng(path.join(targetPackage.basePath, item.path +  item.name)));
                    });
                } else {
                    savePromises.push(item.data.saveAsPng(path.join(targetPackage.basePath, item.path + item.name)));
                }
            } else if (item.type == "component") {
                if (!fs.existsSync(path.join(targetPackage.basePath, "Components/")))
                {
                    fs.mkdirSync(path.join(targetPackage.basePath, "Components/"));
                }
                savePromises.push(fs.writeFile(path.join(targetPackage.basePath, item.path + item.name), item.data));
            } else {
                savePromises.push(fs.writeFile(path.join(targetPackage.basePath, item.path + item.name),  item.data));
            }
        });

        savePromises.push(fs.writeFile(path.join(targetPackage.basePath, 'package.xml'),
            pkgDesc.end({ pretty: true })));

        var pa = Promise.all(savePromises);
        if (option & exports.constants.NO_PACK) {
            pa.then(function () {
                console.log(psdFile + '->' + outputDirectory);
                resolve(buildId);
            }).catch(function (reason) {
                reject(reason);
            });
        }
        else {
            pa.then(function () {
                var fileList = [];

                readFileList(outputDirectory, fileList)
                // return fs.readdir(outputDirectory);
                return fileList;
            }).then(function (files) {
                var output = fs.createWriteStream(outputFile);
                output.on('close', function () {
                    // fs.emptyDirSync(outputDirectory);
                    fs.rmdirSync(outputDirectory,{ recursive: true } );

                    console.log(psdFile + '->' + outputFile);
                    resolve(buildId);
                });

                var zipArchiver = archiver('zip');
                zipArchiver.pipe(output);
                
                files.forEach(function (ff) {
                    zipArchiver.file(ff, { 'name': ff.replace(outputDirectory, "") });
                });
                zipArchiver.finalize();
            }).catch(function (reason) {
                reject(reason);
            });
        }
    });
}

//=====================================================================================
function UIPackage(basePath, buildId) {
    this.id = buildId.substr(0, 8);
    this.itemIdBase = buildId.substr(8);
    this.nextItemIndex = 0;
    this.getNextItemId = function () {
        return this.itemIdBase + (this.nextItemIndex++).toString(36);
    };

    this.basePath = basePath;
    fs.ensureDirSync(basePath);

    this.resources = [];
    this.sameDataTestHelper = {};
    this.sameNameTestHelper = {};
}

function createImage(aNode, scale9Grid) {
    var packageItem = createPackageItem('image', aNode.get('name') + '.png', aNode, false);
    if (scale9Grid) {
        packageItem.scale = '9grid';
        packageItem.scale9Grid = scale9Grid;
    }

    return packageItem;
}

function createComponent(aNode, name) {
    var component = xmlbuilder.create('component');
    component.att('size', aNode.get('width') + ',' + aNode.get('height'));
    var displayList = component.ele('displayList');

    var cnt = aNode.children().length;

    var ctrlList = {}
    
    for (var i = cnt - 1; i >= 0; i--) {
        parseNode(aNode.children()[i], aNode, displayList, null, ctrlList, null);
    }


    for (var itemName in ctrlList) {

        var item = ctrlList[itemName];
        var controllerNode = component.ele("controller")
        controllerNode.att("name", itemName)

        var str = "";
        for (var idx in item){
            if (idx == 0) {
                str = idx + "," + item[idx]
            }
            else
            {
                str = str + "," + idx + "," + item[idx]

            }
        }
        controllerNode.att("pages", str)
        controllerNode.att("selected", "0")
    }
    // return createPackageItem('component',  "components/" +(name ? name : aNode.get('name')) + '.xml', component.end({ pretty: true }));
    return createPackageItem('component', (name ? name : aNode.get('name')) + '.xml', component.end({ pretty: true }), true);
}

function createButton(aNode, instProps, ctrlList) {
    var component = xmlbuilder.create('component');
    component.att('size', aNode.get('width') + ',' + aNode.get('height'));
    component.att('extention', 'Button');

    var images = [];
    var imagePages = [];
    var imageCnt = 0;
    aNode.descendants().forEach(function (childNode) {
        var nodeName = childNode.get('name');
        for (var i in buttonStatusSuffix) {
            if (nodeName.indexOf(buttonStatusSuffix[i]) != -1) {
                images[i] = childNode;
                imageCnt++;
            }
        };
    });
    for (var i in buttonStatusSuffix) {
        imagePages[i] = [];
        if (!images[i]) {
            if (i == 3 && images[1]) //if no 'selectedOver', use 'down'
                imagePages[1].push(i);
            else //or else, use 'up'
                imagePages[0].push(i);
        }
        else {
            imagePages[i].push(i);
        }
    }

    var onElementCallback = function (child, node) {
        var nodeName = node.get('name');
        var j = images.indexOf(node);
        if (j != -1) {
            var gear = child.ele('gearDisplay');
            gear.att('controller', 'button');
            gear.att('pages', imagePages[j].join(','));
        }

        if (nodeName.indexOf('@title') != -1) {
            if (child.attributes['text']) {
                instProps['@title'] = child.attributes['text'].value;
                // console.log("instProps" +instProps['@title'])
                // child.removeAttribute('text');//如果有需要注释这行可以不清空文本
            }
        }
        else if (nodeName.indexOf('@icon') != -1) {
            if (child.attributes['url']) {
                instProps['@icon'] = child.attributes['url'].value;
                child.removeAttribute('url');
            }
        }
    };

    var controller = component.ele('controller');
    controller.att('name', 'button');
    controller.att('pages', '0,up,1,down');

    var displayList = component.ele('displayList');
    var cnt = aNode.children().length;
    for (i = cnt - 1; i >= 0; i--) {
        parseNode(aNode.children()[i], aNode, displayList, onElementCallback, ctrlList);
    }

    var extension = component.ele('Button');
    var nodeName = aNode.get('name')
    if (IsCheckBtn(nodeName) ) {
        extension.att('mode', 'Check');
        instProps['@checked'] = 'true';
    }
    else if (IsRadioBtn(nodeName)){
        extension.att('mode', 'Radio');
    }

    if (imageCnt == 1 && !IsCheckBtn(nodeName)) {
        extension.att('downEffect', 'scale');
        extension.att('downEffectValue', '0.95');
    }

    return createPackageItem('component', aNode.get('name') + '.xml', component.end({ pretty: true }), false);
}

function createProgressBar(aNode, instProps) {
    var component = xmlbuilder.create("component");
    component.att("size", aNode.get("width") + "," + aNode.get("height"));
    component.att("overflow", "hidden");
    component.att("extention", "ProgressBar");

    var targetID;
    var relation;
    var childList = [];
    var onElementCallback = function(child, node) {
        var nodeName = child.attributes["name"].value;
        if (nodeName == "grip") {
            if (targetID == null) {
                relation = child;
                return;
            }

            var re = child.ele("relation");
            re.att("target", targetID);
            re.att("sidePair", "right-right");
            return;
        }

        if (nodeName == "bar") {
            targetID = child.attributes["id"].value;
            if (relation != null) {
                var re = relation.ele("relation");
                re.att("target", targetID);
                re.att("sidePair", "right-right");
            }
        }
    };

    var displayList = component.ele("displayList");
    var cnt = aNode.children().length;
    for (var i = cnt - 1; i >= 0; i--) {
        parseNode(aNode.children()[i], aNode, displayList, onElementCallback);
    }

    var extension = component.ele("Slider");

    return createPackageItem(
        "component",
        aNode.get("name") + ".xml",
        component.end({ pretty: true }),
        false
    );
}


function createSlider(aNode, instProps) {
    var component = xmlbuilder.create('component');
    component.att('size', aNode.get('width') + ',' + aNode.get('height'));
    component.att('extention', 'Slider');

    var targetID;
    var relation;
    var childList = [];

    var onElementCallback = function (child, node) {
        var nodeName = child.attributes["name"].value
        if (nodeName == "grip") {
            if (targetID == null) {
                relation = child;
                return;
            }

            var re =   child.ele("relation");
            re.att('target', targetID) 
            re.att('sidePair', "right-right");
            return;
        }

        if (nodeName == "bar") {
            targetID = child.attributes["id"].value;
            if (relation != null) {
                var re = relation.ele("relation");
                re.att('target', targetID);
                re.att('sidePair',"right-right") ;
            }
        }
    };

    var displayList = component.ele('displayList');
    var cnt = aNode.children().length;
    for (var i = cnt - 1; i >= 0; i--) {
        parseNode(aNode.children()[i], aNode, displayList, onElementCallback);
    }

    var extension = component.ele('Slider');
    // if (aNode.get('name').indexOf(checkButtonPrefix) == 0) {
    //     extension.att('mode', 'Check');
    //     instProps['@checked'] = 'true';
    // }
    // else if (aNode.get('name').indexOf(radioButtonPrefix) == 0)
    //     extension.att('mode', 'Radio');

    // if (imageCnt == 1) {
    //     extension.att('downEffect', 'scale');
    //     extension.att('downEffectValue', '0.95');
    // }

    return createPackageItem('component', aNode.get('name') + '.xml', component.end({ pretty: true }), false);
}

function createPackageItem(type, fileName, data, notInCom) {
    var dataForHash;
    if (type == 'image') //data should a psd layer
        dataForHash = Buffer.from(data.get('image').pixelData);
    else
        dataForHash = data;
    var hash = crypto.createHash('md5').update(dataForHash).digest('hex');
    var item = targetPackage.sameDataTestHelper[hash];
    if (!item) {
        item = {};
        item.type = type;
        
        item.id = targetPackage.getNextItemId();

        var i = fileName.lastIndexOf('.');
        var basename = fileName.substr(0, i);
        var ext = fileName.substr(i);
        // basename = basename.replace(/[\@\'\"\\\/\b\f\n\r\t\$\%\*\:\?\<\>\|]/g, '_');
        if (basename.indexOf("grip@") != -1) {
            basename = basename.replace(/\w+@/g, "");
        } else {
            basename = basename.replace(/@\w+/g, "");
        }
        while (true) {
            var j = targetPackage.sameNameTestHelper[basename];
            if (j == undefined) {
                targetPackage.sameNameTestHelper[basename] = 1;
                break;
            }
            else {
                targetPackage.sameNameTestHelper[basename] = j + 1;
                basename = basename + '_' + j;
            }
        }
        fileName = basename + ext;
        item.name = fileName;

        if (item.type == "image") {
            item.path = "/Images/";
        } else if (item.type == "component" && !notInCom) {
            item.path = "/Components/";
        } else {
            item.path =  "/";
        }
        
        item.data = data;
        targetPackage.resources.push(item);
        targetPackage.sameDataTestHelper[hash] = item;
    }

    return item;
}


function parseNode(aNode, rootNode, displayList, onElementCallback, ctrlList, ctrlItemList) {
    var child;
    var packageItem;
    var instProps;
    var str;

    var nodeName = aNode.get('name');
    var specialUsage;
    if (nodeName.indexOf('@title') != -1)
        specialUsage = 'title';
    else if (nodeName.indexOf('@icon') != -1)
        specialUsage = 'icon';
    else if (nodeName.indexOf('grip@') != -1)
        specialUsage = 'grip';
    else if (nodeName.indexOf('@bar') != -1)
        specialUsage = 'bar';

    if (nodeName.indexOf("bar") != -1)
    {

    }
    if (aNode.isGroup()) {
        if (nodeName.indexOf(componentPrefix) == 0) {
            packageItem = createComponent(aNode);
            child = xmlbuilder.create('component');
            str = 'n' + (displayList.children.length + 1);
            child.att('id', str + '_' + targetPackage.itemIdBase);
            child.att('name', specialUsage ? specialUsage : str);
            child.att('src', packageItem.id);
            child.att('fileName', packageItem.name);
            child.att('xy', (aNode.left - rootNode.left) + ',' + (aNode.top - rootNode.top));
        }
        else if (nodeName.lastIndexOf(commonButtonSuffix) != -1 && IsBtn(nodeName)) {
                 instProps = {};
                 packageItem = createButton(aNode, instProps, ctrlList);
                 child = xmlbuilder.create("component");
                 if (IsRadioBtn(nodeName)) {
                     var parentName = aNode.get("parent").name;
                     var controllerName = /\w+@/.exec(parentName);

                     // console.trace();

                     var ctrlName = controllerName != null ? parentName.replace("@", "") : "c" + (Object.getOwnPropertyNames(ctrlList).length + 1);

                     instProps["@controller"] = ctrlName;
                     instProps["@page"] = ctrlItemList.length;

                     var nodePrefixName = /\w+@/.exec(nodeName);
                     str = nodePrefixName != null ? nodePrefixName[0].replace("@", "") : "n" + (displayList.children.length + 1);
                     ctrlItemList[ctrlItemList.length] = str;
                 } else {
                     // str = 'n' + (displayList.children.length + 1);
                     str = nodeName;
                 }

                 child.att("id", str + "_" + targetPackage.itemIdBase);
                 child.att("name", specialUsage ? specialUsage : str);
                 child.att("src", packageItem.id);
                 child.att("fileName", packageItem.name);
                 child.att("xy", aNode.left - rootNode.left + "," + (aNode.top - rootNode.top));

                 if (specialUsage == "grip") {
                 } else {
                     child.ele({ Button: instProps });
                 }
             } else if (IsProgressBar(nodeName)) {
                 instProps = {};
                 packageItem = createProgressBar(aNode, instProps);
                 child = xmlbuilder.create("component");
                 str = "n" + (displayList.children.length + 1);
                 child.att("id", str + "_" + targetPackage.itemIdBase);
                 child.att("name", specialUsage ? specialUsage : str);
                 child.att("src", packageItem.id);
                 child.att("fileName", packageItem.name);
                 child.att("xy", aNode.left - rootNode.left + "," + (aNode.top - rootNode.top));
                 child.ele({ ProgressBar: instProps });
             } else if (IsSlider(nodeName)) {
                 instProps = {};
                 packageItem = createSlider(aNode, instProps);
                 child = xmlbuilder.create("component");
                 str = "n" + (displayList.children.length + 1);
                 child.att("id", str + "_" + targetPackage.itemIdBase);
                 child.att("name", specialUsage ? specialUsage : str);
                 child.att("src", packageItem.id);
                 child.att("fileName", packageItem.name);
                 child.att("xy", aNode.left - rootNode.left + "," + (aNode.top - rootNode.top));
                 child.ele({ Slider: instProps });
             } else if (nodeName.lastIndexOf(radioGroupSuffix) != -1) {
                 var cnt = aNode.children().length;
                 var ctrlItems = [];
                 for (var i = cnt - 1; i >= 0; i--) parseNode(aNode.children()[i], rootNode, displayList, onElementCallback, ctrlList, ctrlItems);

                 var controllerName = /\w+@/.exec(nodeName);
                 var itemName = controllerName != null ? nodeName.replace("@", "") : "c" + (Object.getOwnPropertyNames(ctrlList).length + 1);
                 ctrlList[itemName] = ctrlItems;
             } else {
                 var cnt = aNode.children().length;
                 for (var i = cnt - 1; i >= 0; i--) parseNode(aNode.children()[i], rootNode, displayList, onElementCallback, ctrlList);
             }
    }
    else {
        var typeTool = aNode.get('typeTool');
        if (typeTool) {
            child = xmlbuilder.create('text');

            var txtName;
            if (specialUsage) {
                txtName = nodeName.substr(0, nodeName.lastIndexOf("@title"))
            }
            else {
                txtName = nodeName;
            }

            if (txtName.lastIndexOf("Txt") == txtName.length - 3) {
                str = txtName
            } else {
                str = 'n' + (displayList.children.length + 1);
            }

            child.att('id', str + '_' + targetPackage.itemIdBase);

            // child.att('name', specialUsage ? specialUsage : str);

            child.att('name', str);
            child.att('text', typeTool.textValue);
            if (specialUsage == 'title' && false) {
                child.att('xy', '0,' + (aNode.top - rootNode.top - 4));
                child.att('size', rootNode.width + ',' + (aNode.height + 8));
                child.att('align', 'center');
            }
            else {
                child.att('xy', (aNode.left - rootNode.left - 4) + ',' + (aNode.top - rootNode.top - 4));
                child.att('size', (aNode.width + 8) + ',' + (aNode.height + 8));
                str = typeTool.alignment()[0];
                if (str != 'left')
                    child.att('align', str);
            }
            child.att('vAlign', 'middle');
            child.att('autoSize', 'none');
            if (!(targetPackage.exportOption & exports.constants.IGNORE_FONT))
                child.att('font', typeTool.fonts()[0]);
            child.att('fontSize', typeTool.sizes()[0]);
            child.att('color', convertToHtmlColor(typeTool.colors()[0]));
        }
        else if (!aNode.isEmpty()) {
            packageItem = createImage(aNode);
            if (specialUsage == 'icon')
                child = xmlbuilder.create('loader');
            else
                child = xmlbuilder.create('image');
            
            str = specialUsage == "bar" ? specialUsage : 'n' + (displayList.children.length + 1);
            child.att('id', str + '_' + targetPackage.itemIdBase);
            child.att('name', specialUsage ? specialUsage : str);
            child.att('xy', (aNode.left - rootNode.left) + ',' + (aNode.top - rootNode.top));
            if (specialUsage == 'icon') {
                child.att('size', aNode.width + ',' + aNode.height);
                child.att('url', 'ui://' + targetPackage.id + packageItem.id);
            }
            else
                child.att('src', packageItem.id);
            child.att('fileName', packageItem.name);
        }
    }

    if (child) {
        var opacity = aNode.get('opacity');
        if (opacity < 255)
            child.att('alpha', (opacity / 255).toFixed(2));

        if (onElementCallback)
            onElementCallback(child, aNode);

        displayList.importDocument(child);
    }

    return child;
}

//=====================================================================================
function genBuildId() {
    var magicNumber = Math.floor(Math.random() * 36).toString(36).substr(0, 1);
    var s1 = '0000' + Math.floor(Math.random() * 1679616).toString(36);
    var s2 = '000' + Math.floor(Math.random() * 46656).toString(36);
    var count = 0;
    for (var i = 0; i < 4; i++) {
        var c = Math.floor(Math.random() * 26);
        count += Math.pow(26, i) * (c + 10);
    }
    count += Math.floor(Math.random() * 1000000) + Math.floor(Math.random() * 222640);

    return magicNumber + s1.substr(s1.length - 4) + s2.substr(s2.length - 3) + count.toString(36);
}

function convertToHtmlColor(rgbaArray, includingAlpha) {
    var result = '#';
    var str;
    if (includingAlpha) {
        str = rgbaArray[3].toString(16);
        if (str.length == 1)
            str = '0' + str;
        result += str;
    }

    for (var i = 0; i < 3; i++) {
        str = rgbaArray[i].toString(16);
        if (str.length == 1)
            str = '0' + str;
        result += str;
    }

    return result;
}