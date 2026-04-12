import os

# Read the sorted list of files (sorted in reverse so deepest items come first)
with open('rename_list.txt', 'r') as f:
    files = [line.strip() for line in f if line.strip()]

for old_path in files:
    if not os.path.exists(old_path):
        print(f"Skipping (not found): {old_path}")
        continue
    
    dir_name = os.path.dirname(old_path)
    base_name = os.path.basename(old_path)
    
    new_base_name = base_name.replace('DietCode', 'DietCode').replace('dietcode', 'dietcode')
    
    new_path = os.path.join(dir_name, new_base_name)
    
    if old_path != new_path:
        print(f"Renaming: {old_path} -> {new_path}")
        os.rename(old_path, new_path)
