"""A tiny original FIT recording, encoded from wholly fictional demo points."""
import datetime as dt
import struct


def crc(data):
    value=0
    for byte in data:
        value^=byte
        for _ in range(8):value=(value>>1)^0xA001 if value&1 else value>>1
    return value


def original_fit(start):
    epoch=dt.datetime(1989,12,31,tzinfo=dt.timezone.utc);stamp=int((start-epoch).total_seconds());data=bytearray()
    def define(local,global_id,fields):
        data.extend(struct.pack('<BBBHB',0x40|local,0,0,global_id,len(fields)))
        for field in fields:data.extend(bytes(field))
    define(0,18,[(253,4,0x86),(2,4,0x86),(5,1,0),(7,4,0x86),(8,4,0x86),(9,4,0x86),(11,2,0x84)])
    data.extend(struct.pack('<BIIBIIIH',0,stamp+600,stamp,1,600000,600000,160000,100))
    define(1,20,[(253,4,0x86),(0,4,0x85),(1,4,0x85),(2,2,0x84),(3,1,0x02),(5,4,0x86),(6,2,0x84)])
    for i in range(21):
        data.extend(struct.pack('<BIiiHBIH',1,stamp+i*30,round(40*2**31/180),round((-75+i*.0009377)*2**31/180),3000+i*5,140+i%5,i*8000,2667))
    header=struct.pack('<BBHI4s',14,0x20,2110,len(data),b'.FIT');header+=struct.pack('<H',crc(header));body=header+data
    return body+struct.pack('<H',crc(body))
