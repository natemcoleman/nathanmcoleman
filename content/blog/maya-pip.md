---
title: "Working with Maya and Pip"
description: ""
date: 2023-10-23T13:02:23-06:00
draft: false
cover:
    image: "/blog/maya-pip/autodesk-instructions.png"
---

Now that Maya supports Python 3, we also get the advantage of using pip to install and manage packages. [Autodesk even provides instructions](https://help.autodesk.com/view/MAYAUL/2024/ENU/?guid=GUID-72A245EC-CDB4-46AB-BEE0-4BBBF9791627) on how to take advantage of the `mayapy` installation.

However, it can be annoying to find the mayapy executable, and you can in fact do everything from within Maya with help from the `sys` module.

```python
import sys

mayapyExecutable = os.path.dirname(sys.executable)
mayapyExecutable = os.path.join(mayapyExecutable, "mayapy.exe")
```

The `sys.executable` in this case gives us the location of the Maya binary, so we can grab the directory and append the mayapy executable to it. From there, we can use the subprocess module to run pip commands.

Here are a few functions to help with this process that return a boolean value indicating success or failure.

```python
import subprocess
import sys

mayapyExecutable = os.path.dirname(sys.executable)
mayapyExecutable = os.path.join(mayapyExecutable, "mayapy.exe")

def pipInstallPackage(packageName) -> bool:
    """Use pip to install a package."""
    command = [
        mayapyExecutable, "-m", "pip", "install", "--upgrade", "--force-reinstall", packageName
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode == 0:
        print(result.stdout)
        return True
    else:
        print(result.stderr)
        return False

def pipList(outdated=False) -> bool:
    """Print the result of pip list."""
    command = [mayapyExecutable, "-m", "pip", "list"]
    if outdated:
        command.append("--outdated")
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode == 0:
        print(result.stdout)
        return True
    else:
        print(result.stderr)
        return False

def checkInstalledVersion(packageName) -> str:
    """Check the installed version of a package."""
    command = [mayapyExecutable, "-m", "pip", "show", packageName]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode == 0:
        # Get the line in the output that contains the version
        for line in result.stdout.splitlines():
            if line.startswith("Version:"):
                return line.split(":")[1].strip()
        return result.stdout
    else:
        return result.stderr
```

Using these functions and a few others, I created a simple GUI for installing and managing packages. It's not perfect, but it's a start.

![gui](/blog/maya-pip/pip-gui.png)
