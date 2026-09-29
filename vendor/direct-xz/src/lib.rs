use lzma_rust2::{XzOptions, XzReader, XzWriter};
use std::io::{Read, Write};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct XzEncoder { writer: Option<XzWriter<Vec<u8>>> }

#[wasm_bindgen]
impl XzEncoder {
    #[wasm_bindgen(constructor)]
    pub fn new(level: u32) -> Result<XzEncoder, JsValue> {
        if level > 9 { return Err(JsValue::from_str("XZ preset must be 0..9")); }
        let writer = XzWriter::new(Vec::new(), XzOptions::with_preset(level))
            .map_err(|e| JsValue::from_str(&format!("XZ encoder init failed: {e}")))?;
        Ok(Self { writer: Some(writer) })
    }
    pub fn write(&mut self, input: &[u8]) -> Result<Vec<u8>, JsValue> {
        let writer = self.writer.as_mut().ok_or_else(|| JsValue::from_str("XZ encoder already finished"))?;
        writer.write_all(input).map_err(|e| JsValue::from_str(&format!("XZ write failed: {e}")))?;
        Ok(std::mem::take(writer.inner_mut()))
    }
    pub fn finish(&mut self) -> Result<Vec<u8>, JsValue> {
        let writer = self.writer.take().ok_or_else(|| JsValue::from_str("XZ encoder already finished"))?;
        writer.finish().map_err(|e| JsValue::from_str(&format!("XZ finish failed: {e}")))
    }
}

#[wasm_bindgen]
pub fn decompress_xz(input: &[u8]) -> Result<Vec<u8>, JsValue> {
    let mut reader = XzReader::new(input, true);
    let mut output = Vec::new();
    reader.read_to_end(&mut output).map_err(|e| JsValue::from_str(&format!("XZ decompression failed: {e}")))?;
    Ok(output)
}
