"""
ONNX 模型优化脚本

针对 AuraVision 模型进行以下优化:
1. 图简化 (Graph Simplification)
2. 算子融合 (Operator Fusion)
3. 常量折叠 (Constant Folding)
4. 可选: FP16 半精度转换

使用方法:
    cd PeroCore/backend
    pip install onnx onnxsim onnxoptimizer
    python ../benchmarks/optimize_onnx_model.py

依赖:
    - onnx
    - onnxsim (onnx-simplifier)
    - onnxoptimizer
"""

import os
import sys
from pathlib import Path

# 模型路径
BACKEND_DIR = Path(__file__).parent.parent / "backend"
MODEL_DIR = BACKEND_DIR / "models" / "AuraVision" / "weights"
INPUT_MODEL = MODEL_DIR / "auravision_v1.onnx"
OUTPUT_MODEL = MODEL_DIR / "auravision_v1_optimized.onnx"
OUTPUT_MODEL_FP16 = MODEL_DIR / "auravision_v1_fp16.onnx"


def check_dependencies():
    """检查依赖是否安装"""
    missing = []
    
    try:
        import onnx
    except ImportError:
        missing.append("onnx")
    
    try:
        import onnxsim
    except ImportError:
        missing.append("onnxsim")
    
    try:
        import onnxoptimizer
    except ImportError:
        missing.append("onnxoptimizer")
    
    if missing:
        print(f"❌ 缺少依赖: {', '.join(missing)}")
        print(f"   请运行: pip install {' '.join(missing)}")
        return False
    
    return True


def get_model_info(model_path: Path) -> dict:
    """获取模型信息"""
    import onnx
    
    if not model_path.exists():
        return None
    
    model = onnx.load(str(model_path))
    graph = model.graph
    
    # 统计算子数量
    op_counts = {}
    for node in graph.node:
        op_counts[node.op_type] = op_counts.get(node.op_type, 0) + 1
    
    # 计算模型大小
    file_size_mb = model_path.stat().st_size / (1024 * 1024)
    
    return {
        "file_size_mb": file_size_mb,
        "num_nodes": len(graph.node),
        "num_inputs": len(graph.input),
        "num_outputs": len(graph.output),
        "op_counts": op_counts
    }


def print_model_info(info: dict, label: str):
    """打印模型信息"""
    print(f"\n📊 {label}")
    print(f"   文件大小: {info['file_size_mb']:.2f} MB")
    print(f"   节点数量: {info['num_nodes']}")
    print(f"   输入数量: {info['num_inputs']}")
    print(f"   输出数量: {info['num_outputs']}")
    print(f"   算子分布: {dict(sorted(info['op_counts'].items(), key=lambda x: -x[1])[:5])}")


def simplify_model(input_path: Path, output_path: Path) -> bool:
    """使用 onnx-simplifier 简化模型"""
    import onnx
    import onnxsim
    
    print(f"\n⏳ 正在简化模型...")
    
    try:
        model = onnx.load(str(input_path))
        
        # 简化
        model_simp, check = onnxsim.simplify(
            model,
            skip_fuse_bn=False,  # 融合 BatchNorm
            skip_constant_folding=False,  # 常量折叠
            skip_shape_inference=False,  # 形状推断
        )
        
        if check:
            onnx.save(model_simp, str(output_path))
            print(f"✅ 模型简化成功: {output_path}")
            return True
        else:
            print("❌ 简化后的模型验证失败")
            return False
    
    except Exception as e:
        print(f"❌ 简化失败: {e}")
        return False


def optimize_model(input_path: Path, output_path: Path) -> bool:
    """使用 onnxoptimizer 进行进一步优化"""
    import onnx
    import onnxoptimizer
    
    print(f"\n⏳ 正在进行图优化...")
    
    try:
        model = onnx.load(str(input_path))
        
        # 可用的优化 pass
        passes = [
            'eliminate_deadend',
            'eliminate_identity',
            'eliminate_nop_dropout',
            'eliminate_nop_pad',
            'eliminate_nop_transpose',
            'eliminate_unused_initializer',
            'fuse_add_bias_into_conv',
            'fuse_bn_into_conv',
            'fuse_consecutive_concats',
            'fuse_consecutive_squeezes',
            'fuse_consecutive_transposes',
            'fuse_matmul_add_bias_into_gemm',
            'fuse_pad_into_conv',
            'fuse_transpose_into_gemm',
        ]
        
        optimized_model = onnxoptimizer.optimize(model, passes)
        onnx.save(optimized_model, str(output_path))
        
        print(f"✅ 图优化完成: {output_path}")
        return True
    
    except Exception as e:
        print(f"❌ 优化失败: {e}")
        return False


def convert_to_fp16(input_path: Path, output_path: Path) -> bool:
    """转换为 FP16 半精度"""
    import onnx
    from onnx import numpy_helper, TensorProto
    
    print(f"\n⏳ 正在转换为 FP16...")
    
    try:
        model = onnx.load(str(input_path))
        
        # 遍历所有初始化器 (权重)
        for initializer in model.graph.initializer:
            if initializer.data_type == TensorProto.FLOAT:
                # 转换为 FP16
                np_array = numpy_helper.to_array(initializer)
                np_array_fp16 = np_array.astype('float16')
                new_initializer = numpy_helper.from_array(np_array_fp16, initializer.name)
                initializer.CopyFrom(new_initializer)
        
        onnx.save(model, str(output_path))
        print(f"✅ FP16 转换完成: {output_path}")
        return True
    
    except Exception as e:
        print(f"❌ FP16 转换失败: {e}")
        return False


def main():
    print("=" * 60)
    print("🔧 ONNX 模型优化工具")
    print("=" * 60)
    
    # 检查依赖
    if not check_dependencies():
        return
    
    # 检查输入模型
    if not INPUT_MODEL.exists():
        print(f"\n❌ 模型文件不存在: {INPUT_MODEL}")
        print("   请先导出 AuraVision 模型为 ONNX 格式")
        return
    
    # 原始模型信息
    original_info = get_model_info(INPUT_MODEL)
    print_model_info(original_info, "原始模型")
    
    # 步骤 1: 简化模型
    temp_path = MODEL_DIR / "temp_simplified.onnx"
    if not simplify_model(INPUT_MODEL, temp_path):
        return
    
    # 步骤 2: 进一步优化
    if not optimize_model(temp_path, OUTPUT_MODEL):
        # 如果优化失败，使用简化后的模型
        import shutil
        shutil.copy(temp_path, OUTPUT_MODEL)
    
    # 清理临时文件
    if temp_path.exists():
        temp_path.unlink()
    
    # 优化后模型信息
    optimized_info = get_model_info(OUTPUT_MODEL)
    print_model_info(optimized_info, "优化后模型")
    
    # 计算节省
    size_reduction = (1 - optimized_info['file_size_mb'] / original_info['file_size_mb']) * 100
    node_reduction = (1 - optimized_info['num_nodes'] / original_info['num_nodes']) * 100
    
    print(f"\n📈 优化效果:")
    print(f"   文件大小减少: {size_reduction:.1f}%")
    print(f"   节点数量减少: {node_reduction:.1f}%")
    
    # 可选: FP16 转换 (自动执行)
    print("\n" + "-" * 60)
    print("生成 FP16 半精度版本...")
    convert_to_fp16(OUTPUT_MODEL, OUTPUT_MODEL_FP16)
    fp16_info = get_model_info(OUTPUT_MODEL_FP16)
    if fp16_info:
        print_model_info(fp16_info, "FP16 模型")
    
    print("\n" + "=" * 60)
    print("✅ 优化完成!")
    print("=" * 60)
    print(f"\n下一步:")
    print(f"   1. 更新 aura_vision.rs 中的模型路径")
    print(f"   2. 重新编译 Rust 模块: maturin build --release")
    print(f"   3. 重新运行 benchmark 验证性能提升")


if __name__ == "__main__":
    main()
