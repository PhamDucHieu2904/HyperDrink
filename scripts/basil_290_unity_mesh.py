"""Decode read-only Unity serialized Mesh assets using their declared channels."""
import pathlib, re, struct

def read_unity_mesh(path):
    source=pathlib.Path(path).read_text(encoding='utf-8-sig')
    count=int(re.search(r'^    m_VertexCount: (\d+)$',source,re.M).group(1))
    channels=[tuple(map(int,c)) for c in re.findall(r'- stream: (\d+)\s+offset: (\d+)\s+format: (\d+)\s+dimension: (\d+)',source)]
    if any(stream!=0 or (fmt!=0 and dim) for stream,offset,fmt,dim in channels):
        raise ValueError('This audited asset must use a single Float32 stream')
    stride=max(offset+dimension*4 for stream,offset,fmt,dimension in channels)
    vertex_bytes=bytes.fromhex(re.search(r'^    _typelessdata: ([0-9a-fA-F]+)$',source,re.M).group(1))
    declared=int(re.search(r'^    m_DataSize: (\d+)$',source,re.M).group(1))
    if len(vertex_bytes)!=declared or len(vertex_bytes)!=count*stride:
        raise ValueError('Vertex stream size does not match the serialized declaration')
    def channel(index):
        _,offset,_,dimension=channels[index]
        return [struct.unpack_from('<'+'f'*dimension,vertex_bytes,i*stride+offset) for i in range(count)] if dimension else None
    index_format=int(re.search(r'^  m_IndexFormat: (\d+)$',source,re.M).group(1))
    index_bytes=bytes.fromhex(re.search(r'^  m_IndexBuffer: ([0-9a-fA-F]+)$',source,re.M).group(1))
    item='H' if index_format==0 else 'I'; item_size=2 if item=='H' else 4
    indices=struct.unpack('<'+item*(len(index_bytes)//item_size),index_bytes)
    subs=[]
    for first,count_sub,base in re.findall(r'firstByte: (\d+)\s+indexCount: (\d+)\s+topology: 0\s+baseVertex: (\d+)',source):
        first=int(first)//item_size; count_sub=int(count_sub); base=int(base)
        subs.append([tuple(i+base for i in indices[n:n+3]) for n in range(first,first+count_sub,3)])
    return dict(positions=channel(0),normals=channel(1),uv=channel(4),submeshes=subs,stride=stride,vertices=count)
