use crate::rpc::RpcError;

pub async fn read(_params: serde_json::Value) -> Result<serde_json::Value, RpcError> {
  Err(RpcError {
    code: -32002,
    message: "Filesystem access not implemented".to_string(),
  })
}

pub async fn write(_params: serde_json::Value) -> Result<serde_json::Value, RpcError> {
  Err(RpcError {
    code: -32002,
    message: "Filesystem access not implemented".to_string(),
  })
}

pub async fn list(_params: serde_json::Value) -> Result<serde_json::Value, RpcError> {
  Err(RpcError {
    code: -32002,
    message: "Filesystem access not implemented".to_string(),
  })
}
