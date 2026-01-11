
import subprocess
import sys
import os

def run_script(path):
    print(f"\n>>> Executing {os.path.basename(path)}...")
    # Pass 1M scale to benchmark 1 by default
    cmd = [sys.executable, path]
    if "benchmark_1" in path:
        cmd.append("1000000")
    
    result = subprocess.run(cmd, capture_output=False)
    return result.returncode == 0

def main():
    # Only the three core benchmarks
    scripts = [
        "benchmarks/benchmark_1_massive_scale.py",
        "benchmarks/benchmark_2_multi_hop_reasoning.py",
        "benchmarks/benchmark_3_real_world_integration.py"
    ]
    
    print("\n" + "="*80)
    print("      PEROCORE CORE BENCHMARK SUITE (UNBIASED & CONSOLIDATED)")
    print("="*80)
    print("Version: 3.0 (Consolidated)")
    current_time = subprocess.check_output(['powershell', 'Get-Date -Format "yyyy-MM-dd HH:mm:ss"']).decode().strip()
    print(f"Time: {current_time}")
    print("-" * 80)
    
    success_count = 0
    for script in scripts:
        # Get just the filename and check in current directory or benchmarks/ subfolder
        script_filename = os.path.basename(script)
        if os.path.exists(script_filename):
            script_path = script_filename
        elif os.path.exists(script):
            script_path = script
        else:
            print(f"Error: Script {script_filename} not found.")
            continue
            
        if run_script(script_path):
            success_count += 1
        
    print("\n" + "="*80)
    print(f"      BENCHMARK SUMMARY: {success_count}/{len(scripts)} COMPLETED")
    print("="*80 + "\n")

if __name__ == "__main__":
    main()
