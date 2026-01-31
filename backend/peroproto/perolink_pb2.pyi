from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Envelope(_message.Message):
    __slots__ = ("id", "source_id", "target_id", "timestamp", "trace_id", "heartbeat", "hello", "register", "request", "response", "stream")
    ID_FIELD_NUMBER: _ClassVar[int]
    SOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_ID_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    TRACE_ID_FIELD_NUMBER: _ClassVar[int]
    HEARTBEAT_FIELD_NUMBER: _ClassVar[int]
    HELLO_FIELD_NUMBER: _ClassVar[int]
    REGISTER_FIELD_NUMBER: _ClassVar[int]
    REQUEST_FIELD_NUMBER: _ClassVar[int]
    RESPONSE_FIELD_NUMBER: _ClassVar[int]
    STREAM_FIELD_NUMBER: _ClassVar[int]
    id: str
    source_id: str
    target_id: str
    timestamp: int
    trace_id: str
    heartbeat: Heartbeat
    hello: Hello
    register: CapabilityRegister
    request: ActionRequest
    response: ActionResponse
    stream: DataStream
    def __init__(self, id: _Optional[str] = ..., source_id: _Optional[str] = ..., target_id: _Optional[str] = ..., timestamp: _Optional[int] = ..., trace_id: _Optional[str] = ..., heartbeat: _Optional[_Union[Heartbeat, _Mapping]] = ..., hello: _Optional[_Union[Hello, _Mapping]] = ..., register: _Optional[_Union[CapabilityRegister, _Mapping]] = ..., request: _Optional[_Union[ActionRequest, _Mapping]] = ..., response: _Optional[_Union[ActionResponse, _Mapping]] = ..., stream: _Optional[_Union[DataStream, _Mapping]] = ...) -> None: ...

class Heartbeat(_message.Message):
    __slots__ = ("seq",)
    SEQ_FIELD_NUMBER: _ClassVar[int]
    seq: int
    def __init__(self, seq: _Optional[int] = ...) -> None: ...

class Hello(_message.Message):
    __slots__ = ("token", "device_name", "client_version", "platform", "capabilities")
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    DEVICE_NAME_FIELD_NUMBER: _ClassVar[int]
    CLIENT_VERSION_FIELD_NUMBER: _ClassVar[int]
    PLATFORM_FIELD_NUMBER: _ClassVar[int]
    CAPABILITIES_FIELD_NUMBER: _ClassVar[int]
    token: str
    device_name: str
    client_version: str
    platform: str
    capabilities: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, token: _Optional[str] = ..., device_name: _Optional[str] = ..., client_version: _Optional[str] = ..., platform: _Optional[str] = ..., capabilities: _Optional[_Iterable[str]] = ...) -> None: ...

class Capability(_message.Message):
    __slots__ = ("name", "description", "params")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    PARAMS_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    params: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., params: _Optional[_Iterable[str]] = ...) -> None: ...

class CapabilityRegister(_message.Message):
    __slots__ = ("capabilities",)
    CAPABILITIES_FIELD_NUMBER: _ClassVar[int]
    capabilities: _containers.RepeatedCompositeFieldContainer[Capability]
    def __init__(self, capabilities: _Optional[_Iterable[_Union[Capability, _Mapping]]] = ...) -> None: ...

class ActionRequest(_message.Message):
    __slots__ = ("action_name", "params")
    class ParamsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ACTION_NAME_FIELD_NUMBER: _ClassVar[int]
    PARAMS_FIELD_NUMBER: _ClassVar[int]
    action_name: str
    params: _containers.ScalarMap[str, str]
    def __init__(self, action_name: _Optional[str] = ..., params: _Optional[_Mapping[str, str]] = ...) -> None: ...

class ActionResponse(_message.Message):
    __slots__ = ("request_id", "status", "data", "error_msg")
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    ERROR_MSG_FIELD_NUMBER: _ClassVar[int]
    request_id: str
    status: int
    data: str
    error_msg: str
    def __init__(self, request_id: _Optional[str] = ..., status: _Optional[int] = ..., data: _Optional[str] = ..., error_msg: _Optional[str] = ...) -> None: ...

class DataStream(_message.Message):
    __slots__ = ("stream_id", "data", "is_end", "content_type")
    STREAM_ID_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    IS_END_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    stream_id: str
    data: bytes
    is_end: bool
    content_type: str
    def __init__(self, stream_id: _Optional[str] = ..., data: _Optional[bytes] = ..., is_end: _Optional[bool] = ..., content_type: _Optional[str] = ...) -> None: ...
