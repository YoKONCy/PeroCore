
import subprocess
import sys
import os

def run_script(path):
    print(f"Running {os.path.basename(path)}...")
    result = subprocess.run([sys.executable, path], capture_output=False)
    return result.returncode == 0

def main():
    scripts = [
        "benchmarks/01_rag_vs_perocore.py",
        "benchmarks/02_massive_scale_performance.py",
        "benchmarks/03_cognitive_precision.py",
        "benchmarks/04_story_intent_reasoning.py"
    ]
    
    print("Starting PeroCore Benchmark Suite v2.0")
    print("=" * 40)
    
    success_count = 0
    for script in scripts:
        if run_script(script):
            success_count += 1
        print("\n")
        
    print("=" * 40)
    print(f"Benchmark Summary: {success_count}/{len(scripts)} passed.")

if __name__ == "__main__":
    main()
