# Provenance and release boundaries

Caption Transactions is an original implementation distributed under the MIT license. It has no affiliation with CapCut, ByteDance, pyCapCut or capcut-cli.

The work was informed by public descriptions of JSON-in-JSON text materials, segment references, timing and text styling. The original research downloads remain outside the public allowlist. Public output contains original notes, URLs, commit pins and hashes, not copied reference implementation.

- pyCapCut source commit ec61408d9f039c4045f946370bb35746b89b2479: reference-only. No LICENSE file or setup license declaration was found in the inspected tree. No redistribution permission was inferred.
- capcut-cli commit 6521c89c0b1b42157e95dd52e98b4ba50487d294: MIT repository; schema page content SHA-256 a64a2262728ac7f9b5269673235c093d380705123267bde7c8235099c3706450. The page describes UTF-16 code-unit ranges and historical doubled ranges. This project refuses doubled/ambiguous partitions instead of repairing them.
- The public schema page's analogy to Python string slicing is not adopted: Python normally indexes Unicode code points, whereas JavaScript indices count UTF-16 code units. Astral Unicode is explicitly covered in the original tests.
- Official CapCut connected editing is existing feature coverage; availability and exact native build compatibility are separate questions.

No native CapCut runtime, private project or asset was opened. The synthetic fixture is invented and must not be described as app-authored evidence. Native reopen and render comparison remain required before claiming CapCut interoperability.

The Windows archive includes Electron45.2.1 (MIT) and Chromium's bundled third-party notices as LICENSE.electron and LICENSES.chromium.html. Those runtime files are third-party redistributables, not recovered CapCut code. Development npm dependencies retain their own license terms and are not included in the source ZIP's node_modules.

This release performs no agent/model call, remote editing, media decoding, proprietary decryption, license bypass or access-control modification.
