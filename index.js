const fs = require('fs');
const opCodes = require('./opcodes.json');

const argv = require('yargs').argv;
if (!argv._[0]) {
    throw 'Need to have filename';
}
const filename = argv._[0];

let segments = {
    data: [],
    constants: require('./default_constants.json'),
};
if (argv.segments) {
    segments = require(argv.segments);
    segments.constants = segments.constants || require('./default_constants.json');
}
const labels = segments.labels ? fixLabels(segments.labels) : {};
// http://sta.c64.org/cbm64scr.html
const bytesToText = require('./c64screen.json');

let pos = 0;
let startAddr = 0;
let writeOutput = 1;
const binary = fs.readFileSync(filename);

function fixLabels(labels) {
    const value = {};
    for (const key in segments.labels) {
        if (key.startsWith('$')) {
            const k = parseInt(key.substring(1), 16);
            value[k] = labels[key];
        } else {
            value[key] = labels[key];
        }
    }
    return value;
}

function output(str) {
    if (writeOutput) {
        console.log(str);
    }
}

function write_constants() {
    for (const key in segments.constants) {
        let value = key;
        if (key.startsWith('$')) {
            value = parseInt(key.substring(1), 16);
        }
        if (labels[value] && labels[value].uses) {
            output(`.label ${segments.constants[key]} = $${value.toString(16)}`);
        }
        setLabel(value, segments.constants[key], 1, 1);
    }
}

function setLabel(addr, name, added, not_use) {
    if (labels[addr]) {
        if (!not_use) {
            // This is not an actual usage
            labels[addr].uses += 1;
        }
        return;
    }
    name = name || 'label' + (Object.keys(labels).length + 1);
    added = added ? 1 : 0;
    labels[addr] = {
        name: name,
        added: added,
        uses: 0
    };
}

function addressToLabel(addr) {
    if (labels[addr] && labels[addr].added) {
        return labels[addr].name;
    }
    return `$${addr.toString(16)}`;
}

function currentAddr() {
    return startAddr + pos - 2;
}

function readWord() {
    const value = binary[pos] + (binary[pos + 1] << 8);
    pos += 2;
    return value;
}

function readByte() {
    const value = binary[pos++];
    return value;
}

function readStartAddress() {
    startAddr = readWord();
    output(`* = $${startAddr.toString(16)}`)
}

function readWriteBytes(bytes) {
    let byteStr = '.byte ';
    const byteArray = [];
    for (let i = 0; i < bytes; i++) {
        byteArray.push(`$${readByte().toString(16)}`);
    }
    output('.byte ' + byteArray.join(', '));
}

function readWriteText(bytes) {
    let textStr = '.text "';
    for (let i = 0; i < bytes; i++) {
        const byte = readByte();
        const char = bytesToText[byte];
        if (!char) {
            throw "Unknown char " + byte;
        }
        textStr = textStr + char;
    }
    output(textStr + '"');
}

function readAbsValue() {
    return `#$${readByte().toString(16)}`;
}

function readZeropAddr(added) {
    added = added || '';
    let label = readByte();
    setLabel(label);
    label = addressToLabel(label);
    return `${label}${added}`;
}

function readIn(added) {
    added = added || '';
    let label = readByte();
    setLabel(label);
    label = addressToLabel(label);
    return `(${label})${added}`;
}

function readAbs(added, preadd) {
    added = added || '';
    preadd = preadd || '';
    let label = readWord();
    setLabel(label);
    label = addressToLabel(label);
    return `${preadd}${label}${added}`;
}

function readRel() {
    let rel = readByte();
    if (rel >= 128) {
        rel = rel - 256;
    }
    const addr = (currentAddr() + rel);
    setLabel(addr);
    label = addressToLabel(addr);
    return `${label}`;
}

function readWriteOpcode() {
    const opCode = readByte();
    const ocX = Math.floor(opCode / 16) + 1;
    const ocY = (opCode % 16) + 1;
    // console.log('read ' + opCode + ` ${ocX} ` + opCodes[ocX][ocY]);
    const opCodeStr = opCodes[ocX][ocY];
    const opCodeMatch = opCodeStr.match(/([A-Z]+)[\s\n]+(\w+)/);
    if (!opCodeMatch) {
        console.log('// Unknown opcode ' + opCode + ` (${opCodeStr}) $${currentAddr().toString(16)}`);
        return readWriteBytes(1);
    }
    const opCodeMnem = opCodeMatch[1].toLowerCase();
    const addressing = opCodeMatch[2];

    const addr = currentAddr();

    let addressingResult = '';
    if (addressing === 'imm') {
        addressingResult = ' ' + readAbsValue();
    }
    else if (addressing === 'imp' || addressing === 'akk') {
        // pass
    }
    else if (addressing === 'zp') {
        addressingResult = readZeropAddr();
    }
    else if (addressing === 'zpx') {
        addressingResult = readZeropAddr(',x');
    }
    else if (addressing === 'zpy') {
        addressingResult = readZeropAddr(',y');
    }
    else if (addressing === 'abx') {
        addressingResult = readAbs(',x');
    }
    else if (addressing === 'aby') {
        addressingResult = readAbs(',y');
    }
    else if (addressing === 'rel') {
        addressingResult = readRel();
    }
    else if (addressing === 'abs') {
        addressingResult = readAbs();
    }
    else if (addressing === 'inx') {
        addressingResult = readIn(',x');
    }
    else if (addressing === 'iny') {
        addressingResult = readIn(',y');
    }
    else if (addressing === 'ind') {
        addressingResult = `(${readAbs()})`;
    }
    else {
        console.log(opCode.toString(16));
        console.log(opCodes[ocX][ocY])
        throw 'Unknown addressing ' + addressing + ' ' + currentAddr() + ' $' + currentAddr().toString(16);
    }
    if (addressingResult) {
        if (labels[addr]) {
            addressingResult = labels[addr].name + ': ' + addressingResult;
            labels[addr].added = 1;
        }

        addressingResult = ' ' + addressingResult;
    }
    output(`\t${opCodeMnem}${addressingResult}`);
    // console.log(`.byte $${opCode.toString(16)}`);
}

function readBasicStart() {
    const savepos = pos;
    const endBasic = readWord();
    const lineNumber = readWord();
    const basicOp = readByte();
    if (basicOp === 158) { // SYS
        let byte = 1;
        let sys_addr = '';
        while(byte !== 0) {
            byte = readByte();
            if (byte) {
                sys_addr += String.fromCharCode(byte);
            }
        }
        pos = savepos;
        output(`// Basic Startup: ${lineNumber} SYS ${sys_addr}`);
        readWriteBytes(endBasic - startAddr);
    } else {
        pos = savepos;
    }
}

function disassemble() {
    pos = 0;
    readStartAddress();
    readBasicStart();
    while (pos < binary.length) {
        // console.log(currentAddr(), pos, binary[pos]);
        const addr = currentAddr();
        if (labels[addr]) {
            output(labels[addr].name + ':  // $' + addr.toString(16));
            labels[addr].added = 1;
        }
        let found = false;
        if (argv.addresses) {
            output('// $' + addr.toString(16));
        }
        for (let i = 0; i < segments.data.length; i++) {
            const seg = segments.data[i];
            if (addr === seg.from && seg.type === 'all') {
                readWriteBytes(seg.to - seg.from + 1);
                found = true;
                break;
            } else if (addr === seg.from && seg.type === 'text') {
                output('.encoding "screencode_upper"');
                readWriteText(seg.to - seg.from + 1);
                found = true;
                break;
            } else if (addr >= seg.from && addr <= seg.to) {
                readWriteBytes(1);
                found = true;
                break;
            }
        }
        if (!found) {
            readWriteOpcode();
        }
    }
}

writeOutput = 0;
// collect labels
write_constants();
disassemble();
writeOutput = 0;
// write out labels
disassemble();
writeOutput = 1;
write_constants();
// write everything
disassemble();
