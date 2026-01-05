use ignore::{WalkBuilder, WalkState};
use regex::Regex;
use serde::{de::{self, Deserializer, Unexpected}, Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};

const MAX_FILE_SIZE: u64 = 1024 * 1024; // 1MB
const DEFAULT_MAX_RESULTS: usize = 100;

// --- Serde 反序列化辅助函数 ---

/// 从字符串反序列化布尔值 (支持 "true", "false", "1", "0")
fn deserialize_bool_from_string<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    match String::deserialize(deserializer)?.to_lowercase().as_str() {
        "true" | "1" => Ok(true),
        "false" | "0" => Ok(false),
        other => Err(de::Error::invalid_value(
            Unexpected::Str(other),
            &"布尔字符串 (true, false, 1, 0)",
        )),
    }
}

/// 从字符串反序列化 usize
fn deserialize_usize_from_string<'de, D>(deserializer: D) -> Result<usize, D::Error>
where
    D: Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    s.parse::<usize>().map_err(|_| {
        de::Error::invalid_value(Unexpected::Str(&s), &"无符号整数字符串")
    })
}

/// 搜索请求参数
#[derive(Deserialize, Debug)]
struct SearchParams {
    /// 搜索关键词或正则表达式
    query: String,
    /// 搜索相对路径
    search_path: Option<String>,
    /// 是否大小写敏感
    #[serde(default, deserialize_with = "deserialize_bool_from_string")]
    case_sensitive: bool,
    /// 是否全字匹配
    #[serde(default, deserialize_with = "deserialize_bool_from_string")]
    whole_word: bool,
    /// 上下文行数
    #[serde(default = "default_context_lines", deserialize_with = "deserialize_usize_from_string")]
    context_lines: usize,
}

fn default_context_lines() -> usize { 2 }

/// 单个文件中的搜索结果
#[derive(Serialize, Debug)]
struct FileMatch {
    /// 文件的相对路径
    file_path: String,
    /// 匹配所在的行号
    line_number: usize,
    /// 匹配行的内容
    line_content: String,
    /// 匹配行之前的上下文
    context_before: Vec<String>,
    /// 匹配行之后的上下文
    context_after: Vec<String>,
    /// 匹配在行内的起始列索引
    match_column: usize,
}

/// 最终输出结果
#[derive(Serialize, Debug)]
struct SearchResponse {
    /// 状态: "success" 或 "error"
    status: String,
    /// 匹配结果列表
    results: Option<Vec<FileMatch>>,
    /// 错误信息
    error: Option<String>,
    /// 结果是否因为达到上限而被截断
    #[serde(skip_serializing_if = "Option::is_none")]
    is_truncated: Option<bool>,
}

/// 全局配置
struct EngineConfig {
    /// 最大搜索结果数
    max_results_limit: usize,
    /// 忽略的文件夹名称
    ignored_folder_names: HashSet<String>,
    /// 允许的搜索文件后缀
    allowed_file_extensions: HashSet<String>,
}

impl EngineConfig {
    /// 从环境变量加载配置
    fn load_from_env() -> Self {
        let max_results_limit = env::var("MAX_RESULTS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_MAX_RESULTS);

        let ignored_folder_names = env::var("IGNORED_FOLDERS")
            .unwrap_or_else(|_| "target,.git,node_modules,dist,build".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let allowed_file_extensions = env::var("ALLOWED_EXTENSIONS")
            .unwrap_or_else(|_| "rs,toml,md,txt,js,ts,py,java,go,yml,yaml,json,vue,css,html,xml,sql,sh,bat".to_string())
            .split(',')
            .map(|s| s.trim().replace(".", ""))
            .filter(|s| !s.is_empty())
            .collect();

        EngineConfig {
            max_results_limit,
            ignored_folder_names,
            allowed_file_extensions,
        }
    }
}

/// 寻找项目根目录 (根据 .git, package.json 或 Cargo.toml 判断)
fn find_project_root() -> PathBuf {
    // 从当前工作目录开始向上查找
    if let Ok(mut current_path) = env::current_dir() {
        // 最多向上查找 5 层
        for _ in 0..5 {
            if current_path.join(".git").is_dir()
                || current_path.join("package.json").is_file()
                || current_path.join("Cargo.toml").is_file()
            {
                return current_path;
            }
            if !current_path.pop() {
                // 已到达根目录
                break;
            }
        }
    }
    // 如果没找到，默认返回当前目录
    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

/// 检查文件内容是否为二进制 (判断前 1024 字节是否包含空字节)
fn is_binary_file(file_data: &[u8]) -> bool {
    let check_length = std::cmp::min(file_data.len(), 1024);
    file_data[0..check_length].contains(&0)
}

fn main() {
    let mut stdin_buffer = String::new();
    // 尝试从标准输入读取 JSON 参数
    if let Err(e) = io::stdin().read_to_string(&mut stdin_buffer) {
        report_error(format!("无法读取标准输入: {}", e));
        return;
    }

    let search_params: SearchParams = match serde_json::from_str(&stdin_buffer) {
        Ok(params) => params,
        Err(e) => {
            report_error(format!("JSON 解析失败: {}. 输入内容: {}", e, stdin_buffer));
            return;
        }
    };

    let engine_config = EngineConfig::load_from_env();
    
    let search_regex = match compile_search_regex(&search_params) {
        Ok(re) => re,
        Err(e) => {
            report_error(format!("正则表达式无效: {}", e));
            return;
        }
    };

    let project_root_path = find_project_root();
    
    let target_search_path = match search_params.search_path.as_ref() {
        Some(relative_path) => project_root_path.join(relative_path),
        None => project_root_path.clone(),
    };

    match execute_directory_search(&target_search_path, &search_regex, &engine_config, &search_params, &project_root_path) {
        Ok((matches, was_truncated)) => {
            let response = SearchResponse {
                status: "success".to_string(),
                results: Some(matches),
                error: None,
                is_truncated: if was_truncated { Some(true) } else { None },
            };
            if let Ok(json_output) = serde_json::to_string(&response) {
                println!("{}", json_output);
            }
        }
        Err(e) => report_error(format!("搜索执行失败: {}", e)),
    }
}

/// 根据搜索参数构建正则表达式
fn compile_search_regex(params: &SearchParams) -> Result<Regex, regex::Error> {
    let mut regex_pattern = regex::escape(&params.query);

    if params.whole_word {
        regex_pattern = format!(r"\b{}\b", regex_pattern);
    }

    let regex_pattern = if params.case_sensitive {
        regex_pattern
    } else {
        format!("(?i){}", regex_pattern)
    };

    Regex::new(&regex_pattern)
}

/// 在指定目录中执行并行搜索
fn execute_directory_search(
    target_path: &Path,
    query_regex: &Regex,
    engine_config: &EngineConfig,
    search_params: &SearchParams,
    project_root: &Path,
) -> Result<(Vec<FileMatch>, bool), io::Error> {
    let mut walker_builder = WalkBuilder::new(target_path);
    walker_builder.hidden(false).git_ignore(true).max_filesize(Some(MAX_FILE_SIZE));

    for folder_name in &engine_config.ignored_folder_names {
        walker_builder.add_ignore(folder_name);
    }

    let (result_sender, result_receiver) = mpsc::channel();
    let query_regex = query_regex.clone();
    let project_root_buf = project_root.to_path_buf();
    let allowed_exts = engine_config.allowed_file_extensions.clone();
    let context_lines_count = search_params.context_lines;
    
    // 用于多线程间共享的匹配计数器
    let shared_match_counter = Arc::new(AtomicUsize::new(0));
    let max_results_cap = engine_config.max_results_limit;

    walker_builder.build_parallel().run(move || {
        let sender = result_sender.clone();
        let regex = query_regex.clone();
        let root_path = project_root_buf.clone();
        let extensions = allowed_exts.clone();
        let counter = shared_match_counter.clone();

        Box::new(move |entry| {
            // 如果已达到结果上限，停止搜索
            if counter.load(Ordering::Relaxed) >= max_results_cap {
                return WalkState::Quit;
            }

            let entry = match entry {
                Ok(e) => e,
                Err(_) => return WalkState::Continue,
            };

            if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                return WalkState::Continue;
            }

            let current_file_path = entry.path();
            if !extensions.is_empty() {
                if let Some(ext) = current_file_path.extension().and_then(|s| s.to_str()) {
                    if !extensions.contains(ext) {
                        return WalkState::Continue;
                    }
                } else {
                    return WalkState::Continue;
                }
            }

            // 读取并检查文件内容
            match fs::read(current_file_path) {
                Ok(file_bytes) => {
                    if is_binary_file(&file_bytes) {
                        return WalkState::Continue;
                    }
                    
                    let file_content = String::from_utf8_lossy(&file_bytes);
                    
                    let file_matches = perform_search_in_content(
                        &file_content,
                        &regex,
                        current_file_path,
                        &root_path,
                        context_lines_count,
                        &counter,
                        max_results_cap
                    );
                    
                    if !file_matches.is_empty() {
                        let _ = sender.send(file_matches);
                    }
                },
                Err(_) => return WalkState::Continue, // 跳过无法读取的文件
            }
            
            if counter.load(Ordering::Relaxed) >= max_results_cap {
                WalkState::Quit
            } else {
                WalkState::Continue
            }
        })
    });

    let mut all_matches: Vec<FileMatch> = result_receiver.into_iter().flatten().collect();

    // 再次检查并截断结果
    let result_was_truncated = if all_matches.len() > engine_config.max_results_limit {
        all_matches.truncate(engine_config.max_results_limit);
        true
    } else {
        false
    };

    Ok((all_matches, result_was_truncated))
}

/// 在单个文件内容中搜索匹配项
fn perform_search_in_content(
    content: &str,
    regex: &Regex,
    file_path: &Path,
    project_root: &Path,
    context_lines: usize,
    global_counter: &AtomicUsize,
    max_results_limit: usize,
) -> Vec<FileMatch> {
    let content_lines: Vec<&str> = content.lines().collect();
    let mut file_matches = Vec::new();
    
    let relative_file_path = pathdiff::diff_paths(file_path, project_root)
        .unwrap_or_else(|| file_path.to_path_buf());

    for (line_idx, line_text) in content_lines.iter().enumerate() {
        if let Some(regex_match) = regex.find(line_text) {
            // 增加全局计数并检查是否达到上限
            let current_total = global_counter.fetch_add(1, Ordering::Relaxed);
            if current_total >= max_results_limit {
                break;
            }

            // 获取匹配行之前的上下文
            let context_before = if line_idx >= context_lines {
                content_lines[line_idx.saturating_sub(context_lines)..line_idx]
                    .iter()
                    .map(|s| s.to_string())
                    .collect()
            } else {
                content_lines[0..line_idx].iter().map(|s| s.to_string()).collect()
            };

            // 获取匹配行之后的上下文
            let after_end_idx = std::cmp::min(line_idx + 1 + context_lines, content_lines.len());
            let context_after = content_lines[line_idx + 1..after_end_idx]
                .iter()
                .map(|s| s.to_string())
                .collect();

            file_matches.push(FileMatch {
                file_path: relative_file_path.to_string_lossy().into_owned(),
                line_number: line_idx + 1,
                line_content: line_text.trim().to_string(),
                context_before,
                context_after,
                match_column: regex_match.start(),
            });
        }
    }

    file_matches
}

/// 格式化并输出错误信息
fn report_error(error_msg: String) {
    let response = SearchResponse {
        status: "error".to_string(),
        results: None,
        error: Some(error_msg),
        is_truncated: None,
    };
    if let Ok(json_error) = serde_json::to_string(&response) {
        println!("{}", json_error);
    }
}
