# Terminal file preview

Status: implemented and verified on 2026-10-29.

Users should be able to inspect files mentioned by an agent or shell without copying the path into another application or first publishing the file as a task artifact.

The interaction is to click a local file path in either a task terminal or an independent terminal. Images open in a zoomable dialog; text and Markdown open in a read-only dialog. Unsupported formats offer an explicit action to open the file with the host's default application.

Support absolute paths, home-relative paths, explicit relative paths, and local `file:` links. Relative paths resolve from the terminal's launch directory. Bare filenames with recognized extensions are also candidates; nonexistent candidates display a readable error. Quoted paths can contain spaces. Unquoted paths with spaces, and paths an agent's own renderer broke onto the next line (a real newline plus indentation, not a terminal soft wrap), are also clickable once the joined path names an existing file; prose after a path is never absorbed unless that longer file exists. Line and column suffixes identify a file, without becoming part of its name. HTTP and HTTPS links retain their existing behavior.

The first version does not inject shell integration to track `cd`, implement a shell command for opening files, render terminal image protocols, or edit files. After changing directory, users can output an absolute path. Directories and special files are not read as file previews.

See [implementation plan](plan.md) for requirements, boundaries, and acceptance checks.
