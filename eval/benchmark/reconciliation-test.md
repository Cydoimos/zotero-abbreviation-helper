# Reconciliation log - test set

Step 2 of the labelling process (see GUIDELINES.md): after the blind pass the
detector was run once and every disagreement was re-checked against the paper.
Only the changes below were made. Nothing was changed to flatter the detector:
outputs that are correct and useful but that the rules do not cover (for
example an abbreviation that only ever appears inside a hyphenated compound)
were left counting as false positives.

Entries added here as `undefined` carry `"recon": true`, so glossary recall
can be reported with and without them.

- 10.1016/j.isci.2025.112363: ignore += Cas9  (ignore category the paper's list missed)
- 10.1016/j.xcrm.2024.101849: ignore += mg/L  (ignore category the paper's list missed)
- 10.1016/j.xcrm.2024.101849: ignore += IL-1a  (ignore category the paper's list missed)
- 10.1016/j.xcrm.2024.101849: ignore += IL-1b  (ignore category the paper's list missed)
- 10.1021/acscentsci.5c00939: ignore += nM  (ignore category the paper's list missed)
- 10.1021/acscentsci.5c00939: ignore += 3SA  (ignore category the paper's list missed)
- 10.1021/acscentsci.5c00939: ignore += 6SA  (ignore category the paper's list missed)
- 10.1021/acscentsci.5c00939: ignore += STEMCELL  (ignore category the paper's list missed)
- 10.1038/s42003-024-07383-z: ignore += IIa  (ignore category the paper's list missed)
- 10.1021/acsomega.5c03570: ignore += CCl  (ignore category the paper's list missed)
- 10.3390/polym16233296: ignore += ChiTuBox  (ignore category the paper's list missed)
- 10.1242/bio.062018: ignore += A-D  (ignore category the paper's list missed)
- 10.1371/journal.pcbi.1013471: ignore += C-D  (ignore category the paper's list missed)
- 10.1016/j.isci.2025.112363: undefined += DNA = deoxyribonucleic acid  (standard, used >=2x standalone, never defined; missed by the blind pass)
- 10.1016/j.isci.2025.112363: undefined += RNA = ribonucleic acid  (standard, used >=2x standalone, never defined; missed by the blind pass)
- 10.1016/j.isci.2025.112363: undefined += CRISPR = clustered regularly interspaced short palindromic repeats  (standard, used >=2x standalone, never defined; missed by the blind pass)
- 10.1016/j.isci.2025.112363: undefined += DMSO = dimethyl sulfoxide  (standard, used >=2x standalone, never defined; missed by the blind pass)
- 10.1016/j.isci.2025.112363: undefined += ANOVA = analysis of variance  (standard, used >=2x standalone, never defined; missed by the blind pass)
- 10.1016/j.xcrm.2024.101849: undefined += PCR = polymerase chain reaction  (standard, used >=2x standalone, never defined; missed by the blind pass)
- 10.1038/s44321-025-00298-0: undefined += DMEM = Dulbecco's Modified Eagle Medium  (standard, used >=2x standalone, never defined; missed by the blind pass)
- 10.1098/rsob.230270: undefined += DNA = deoxyribonucleic acid  (standard, used >=2x standalone, never defined; missed by the blind pass)
- 10.1098/rsob.230270: undefined += RNA = ribonucleic acid  (standard, used >=2x standalone, never defined; missed by the blind pass)
- 10.1098/rsob.230270: undefined += EGTA = ethylene glycol tetraacetic acid  (standard, used >=2x standalone, never defined; missed by the blind pass)
- 10.1098/rsob.230270: undefined += SDS-PAGE = sodium dodecyl sulfate polyacrylamide gel electrophoresis  (standard, used >=2x standalone, never defined; missed by the blind pass)
- 10.26508/lsa.202402671: undefined += GFP = green fluorescent protein  (standard, used >=2x standalone, never defined; missed by the blind pass)
- 10.26508/lsa.202402671: undefined += HPLC = high-performance liquid chromatography  (standard, used >=2x standalone, never defined; missed by the blind pass)

- 10.1186/s40168-024-01997-5: rRNA alt += "ribosomal RNA" (same meaning, written with the abbreviation RNA)
- 10.1098/rsob.230270: EGTA alt += the full IUPAC-style name (same compound)
- 10.26508/lsa.202402671: DTT alt += "1,4-dithiothreitol" (same compound)
- scorer: meanings are now compared spacing- and hyphen-blind, because PDF text
  extraction splits and glues words ("bone marrowderived", "deep neural net works");
  the label records the repaired meaning, so reproducing the damaged text counts as correct.
